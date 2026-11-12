package org.posegood.api.account;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

import org.posegood.api.common.ApiError;
import org.posegood.api.common.KstTime;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** Current consent documents are versioned in contracts/consent-documents.v2.md. */
@Repository
public class ConsentRepository {
	public static final String VERSION = "service-v2";
	public static final Set<String> REQUIRED = Set.of("TERMS", "ACCOUNT_INFO", "POSE_COORDINATES", "MEASUREMENT_RECORD",
		"AGE_14_OVER");
	private final JdbcTemplate jdbc;

	public ConsentRepository(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	public static boolean validate(List<AccountContracts.Consent> consents, AccountContracts.Profile profile) {
		if (consents == null) {
			throw required();
		}
		var types = new HashSet<String>();
		for (var consent : consents) {
			if (consent == null || !VERSION.equals(consent.documentVersion()) || !types.add(consent.type())
				|| (!REQUIRED.contains(consent.type()) && !"OPTIONAL_PROFILE".equals(consent.type()))) {
				throw required();
			}
		}
		if (!types.containsAll(REQUIRED)) {
			throw required();
		}
		boolean optional = types.contains("OPTIONAL_PROFILE");
		validateProfile(profile, optional);
		return optional;
	}

	public static void validateProfile(AccountContracts.Profile profile, boolean optional) {
		if (profile == null || profile.name() == null || profile.name().isBlank() || profile.name().length() > 30
			|| (profile.age() != null && (profile.age() < 14 || profile.age() > 120))
			|| (profile.occupation() != null
				&& (profile.occupation().isBlank() || profile.occupation().length() > 80))) {
			throw ApiError.badRequest("invalid profile");
		}

		if (!optional && (profile.age() != null || profile.occupation() != null)) {
			throw required();
		}
	}

	public void insert(long owner, List<AccountContracts.Consent> consents) {
		var now = KstTime.now();
		for (var consent : consents) {
			jdbc.update(
				"INSERT INTO user_consent(user_account_id,consent_type,agreed_at,document_version) VALUES(?,?,?,?)",
				owner, consent.type(), now, consent.documentVersion());
		}
	}

	public boolean optional(long owner) {
		var values = jdbc.queryForList("SELECT withdrawn_at IS NULL FROM user_consent WHERE user_account_id=?"
			+ " AND consent_type='OPTIONAL_PROFILE' ORDER BY agreed_at DESC LIMIT 1", Boolean.class, owner);
		return !values.isEmpty() && values.get(0);
	}

	private static ApiError required() {
		return new ApiError(400, "CONSENT_REQUIRED", "explicit current consent is required");
	}
}
