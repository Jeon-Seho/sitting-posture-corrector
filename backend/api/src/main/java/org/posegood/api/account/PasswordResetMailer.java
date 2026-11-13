package org.posegood.api.account;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Component;

/**
 * 비밀번호 재설정 메일 보내기. SMTP는 Spring 표준 설정({@code spring.mail.*}, 환경변수 {@code POSEGOOD_MAIL_*})을 쓴다.
 *
 * 메일에는 일회용 링크만 담고 비밀번호(새·임시 모두)는 담지 않는다. 링크·주소는 로그에 남기지 않는다.
 * 기능을 켰는데 SMTP가 없으면 시작하지 않는다 — 보내지 못한 메일을 보낸 것처럼 꾸미지 않는다.
 */
@Component
public class PasswordResetMailer {
	private final ObjectProvider<JavaMailSender> senders;
	private final String host;
	private final String from;

	public PasswordResetMailer(
		ObjectProvider<JavaMailSender> senders,
		@Value("${spring.mail.host:}")
		String host,
		@Value("${posegood.auth.mail-from:}")
		String from) {
		this.senders = senders;
		this.host = host.strip();
		this.from = from.strip();
	}

	/** 기능을 켤 때 확인한다. */
	void requireReady() {
		if (host.isEmpty() || senders.getIfAvailable() == null || from.isEmpty()) {
			throw new IllegalStateException(
				"password reset needs spring.mail.host (POSEGOOD_MAIL_HOST) and posegood.auth.mail-from");
		}
	}

	/** 재설정 링크 메일. 실패하면 Spring 메일 예외가 그대로 나간다(호출한 쪽이 기록만 한다). */
	public void sendReset(String to, String link, long lifetimeMinutes) {
		var message = new SimpleMailMessage();
		message.setFrom(from);
		message.setTo(to);
		message.setSubject("[바른자세] 비밀번호 재설정 안내");
		message.setText(String.join("\n",
			"바른자세 비밀번호 재설정을 요청하셨어요.",
			"",
			"아래 링크를 열어 새 비밀번호를 정해 주세요. 링크는 " + lifetimeMinutes + "분 동안 한 번만 쓸 수 있어요.",
			link,
			"",
			"요청하지 않으셨다면 이 메일을 무시해 주세요. 비밀번호는 바뀌지 않아요.",
			"바른자세는 메일로 비밀번호를 보내거나 묻지 않아요."));
		senders.getObject().send(message);
	}
}
