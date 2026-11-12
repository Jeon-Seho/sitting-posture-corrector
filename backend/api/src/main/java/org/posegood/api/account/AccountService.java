package org.posegood.api.account;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;

import org.posegood.api.common.ApiError;
import org.posegood.api.common.KstTime;
import org.posegood.api.policy.ThresholdPolicyRepository;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 계정 규칙 처리: 가입, 비밀번호 변경, 탈퇴 접수.
 *
 * 탈퇴는 접수만 한다. 30일 유예 뒤 최종 삭제는 Spark J3(cron 매일 04:00)가 맡는다(아키텍처 v5.2).
 * 근거: contracts/accounts.v2.md, database/README.md 9장.
 */
@Service
public class AccountService {
	private final AccountRepository accounts;
	private final ThresholdPolicyRepository policies;
	private final ConsentRepository consents;
	private final PasswordEncoder passwords;
	private final UserLocks locks;
	private final TransactionTemplate tx;
	private final ApplicationEventPublisher events;

	public AccountService(
		AccountRepository accounts,
		ThresholdPolicyRepository policies,
		ConsentRepository consents,
		PasswordEncoder passwords,
		UserLocks locks,
		TransactionTemplate tx,
		ApplicationEventPublisher events) {
		this.accounts = accounts;
		this.policies = policies;
		this.consents = consents;
		this.passwords = passwords;
		this.locks = locks;
		this.tx = tx;
		this.events = events;
	}

	/**
	 * 비밀번호 없이 소셜 로그인으로만 가입한 계정의 {@code password_hash} 값. BCrypt 형식이 아니어서 어떤 비밀번호와도
	 * 맞지 않는다. 비밀번호는 비밀번호 재설정 메일로 정할 수 있다.
	 */
	public static final String NO_PASSWORD = "!no-password";

	/** 비밀번호로 로그인할 수 있는 계정인가(소셜 전용 계정이 아닌가). */
	public static boolean hasPassword(AccountRepository.Account account) {
		return account.hash() != null && account.hash().startsWith("$2");
	}

	/** 이메일 정규화(앞뒤 공백 제거, 소문자). */
	public static String normalize(String email) {
		return email.strip().toLowerCase(Locale.ROOT);
	}

	/**
	 * 정상(ACTIVE) 계정만 통과. 없거나 탈퇴 중이면 401.
	 */
	public AccountRepository.Account requireActive(long id) {
		var account = accounts.find(id);
		if (account == null || !account.active()) {
			throw new ApiError(401, "UNAUTHENTICATED", "authentication required");
		}
		return account;
	}

	/** 가입: 비밀번호 규칙·동의 확인 후 기본 판정 정책으로 계정을 만든다. */
	public AccountRepository.Account register(AccountContracts.Register body) {
		requireNewPassword(body.password());
		ConsentRepository.validate(body.consents(), body.profile());
		long id = tx.execute(
			status -> {
				long owner = accounts.insert(
					normalize(body.email()),
					passwords.encode(body.password()),
					body.profile(),
					policies.defaultId());
				consents.insert(owner, body.consents());
				return owner;
			});
		return requireActive(id);
	}

	/**
	 * 소셜 가입: 비밀번호 없이({@link #NO_PASSWORD}) 계정을 만들고 같은 트랜잭션에서 소셜 연결을 저장한다.
	 * 이메일은 제공자가 확인한 주소다. 동의·프로필 규칙은 일반 가입과 같다.
	 */
	public AccountRepository.Account registerSocial(
		String email, AccountContracts.Profile profile, List<AccountContracts.Consent> consentList,
		String provider, String subject, SocialIdentityRepository identities) {
		ConsentRepository.validate(consentList, profile);
		long id = tx.execute(
			status -> {
				long owner = accounts.insert(normalize(email), NO_PASSWORD, profile, policies.defaultId());
				consents.insert(owner, consentList);
				identities.insert(owner, provider, subject);
				return owner;
			});
		return requireActive(id);
	}

	/**
	 * 비밀번호 재설정 반영: 새 해시를 저장하고 모든 로그인을 끊는다. 호출한 쪽의 트랜잭션 안에서 실행한다.
	 * 실시간 연결 닫기({@link LoginsRemoved})는 트랜잭션이 끝난 뒤 호출한 쪽이 알린다.
	 */
	void applyResetPassword(long id, String newPassword) {
		requireNewPassword(newPassword);
		accounts.changePassword(id, passwords.encode(newPassword));
		accounts.removeLogins(id);
	}

	/** 비밀번호 변경: 모든 로그인을 끊고 실시간 연결도 닫게 알린다. */
	public void changePassword(long id, AccountContracts.PasswordChange body) {
		requireNewPassword(body.newPassword());
		locks.run(
			id,
			() -> {
				var account = requireActive(id);
				requireCurrent(body.currentPassword(), account.hash());
				tx.executeWithoutResult(
					status -> {
						accounts.changePassword(id, passwords.encode(body.newPassword()));
						accounts.removeLogins(id);
					});
			});
		events.publishEvent(new LoginsRemoved(id));
	}

	/**
	 * 탈퇴 접수: 계정을 CLOSED로 바꾸고 모든 로그인을 끊는다. 되돌릴 수 없다(철회 없음).
	 *
	 * 유예 기간(30일)에는 식별 정보와 기록을 그대로 둔다. 유예가 끝나면 Spark J3가 지운다.
	 */
	public void withdraw(long id, AccountContracts.Withdrawal body) {
		locks.run(
			id,
			() -> {
				var account = requireActive(id);
				requireCurrent(body.password(), account.hash());
				tx.executeWithoutResult(
					status -> {
						accounts.close(id, KstTime.now());
						accounts.removeLogins(id);
					});
			});
		events.publishEvent(new LoginsRemoved(id));
		events.publishEvent(new AccountClosed(id));
	}

	/** 현재 비밀번호 확인(틀리면 400). */
	public void requireCurrent(String password, String hash) {
		if (password.getBytes(StandardCharsets.UTF_8).length > 72 || !passwords.matches(password, hash)) {
			throw new ApiError(400, "INVALID_PASSWORD", "current password is incorrect");
		}
	}

	/** 새 비밀번호 규칙: 12자 이상, UTF-8 72바이트 이하. */
	static void requireNewPassword(String password) {
		if (password.length() < 12 || password.getBytes(StandardCharsets.UTF_8).length > 72) {
			throw new ApiError(
				400,
				"INVALID_PASSWORD",
				"password must have 12 or more characters and at most 72 UTF-8 bytes");
		}
	}

	/**
	 * 탈퇴 접수 알림: 진행 중 세션을 메모리에서 정리한다.
	 */
	public record AccountClosed(long userId) {
	}

	/**
	 * 로그인 삭제 알림: 열린 실시간(WebSocket) 연결을 닫는다.
	 *
	 * 그 로그인으로 열린 연결은 로그인 행이 지워진 뒤에도 남아 있으므로 따로 닫아야 한다.
	 */
	public record LoginsRemoved(long userId) {
	}
}
