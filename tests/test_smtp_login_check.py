"""(D-110) 통합 테스트 0단계 SMTP 로그인 시험 — 메일은 보내지 않고, 값은 출력하지 않는다."""

import os
import smtplib
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools", "platform"))

import smtp_login_check as smtp_check  # noqa: E402

SECRET = "wrong-but-secret-value"  # 출력에 나오면 안 되는 값
USER = "someone@example.invalid"


class FakeSmtp:
    """smtplib.SMTP 대신 — 정해 둔 단계에서 정해 둔 예외를 낸다."""

    starttls_supported = True
    fail_at = None
    error = None
    calls = []

    def __init__(self, host, port, timeout=None):
        FakeSmtp.calls = [("connect", host, port)]
        if self.fail_at == "connect":
            raise self.error

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def ehlo(self):
        FakeSmtp.calls.append(("ehlo",))
        return 250, b"ok"

    def has_extn(self, name):
        return name == "starttls" and self.starttls_supported

    def starttls(self, context=None):
        FakeSmtp.calls.append(("starttls",))
        if self.fail_at == "starttls":
            raise self.error
        return 220, b"ready"

    def login(self, user, password):
        FakeSmtp.calls.append(("login",))
        if self.fail_at == "login":
            raise self.error
        return 235, b"ok"

    def sendmail(self, *args):  # 불리면 안 된다
        raise AssertionError("메일을 보내면 안 됨")


def fake(fail_at=None, error=None, starttls=True):
    return type("Smtp", (FakeSmtp,), {"fail_at": fail_at, "error": error, "starttls_supported": starttls})


class CheckTest(unittest.TestCase):
    def run_check(self, smtp_class, host="smtp.gmail.com", password=SECRET):
        code, message = smtp_check.check(host, 587, USER, password, smtp_class=smtp_class)
        self.assertNotIn(SECRET, message)
        self.assertNotIn(USER, message)
        return code, message

    def test_login_success_uses_starttls_and_sends_nothing(self):
        code, _ = self.run_check(fake())
        self.assertEqual(code, 0)
        self.assertEqual([c[0] for c in FakeSmtp.calls], ["connect", "ehlo", "starttls", "ehlo", "login"])

    def test_rejected_login_is_code_1_with_gmail_length_hint(self):
        code, message = self.run_check(fake("login", smtplib.SMTPAuthenticationError(535, b"5.7.8 bad " + USER.encode())))
        self.assertEqual(code, 1)
        self.assertIn("535", message)
        self.assertIn("16자", message)

    def test_disconnect_at_login_counts_as_rejected_login(self):
        code, message = self.run_check(fake("login", smtplib.SMTPServerDisconnected("closed")))
        self.assertEqual(code, 1)
        self.assertIn("로그인 단계", message)

    def test_sixteen_character_gmail_password_gets_no_length_hint(self):
        _, message = self.run_check(fake("login", smtplib.SMTPAuthenticationError(535, b"bad")),
                                    password="abcdefghijklmnop")
        self.assertNotIn("16자", message)

    def test_connection_failure_is_code_2(self):
        code, message = self.run_check(fake("connect", OSError("unreachable")))
        self.assertEqual(code, 2)
        self.assertIn("연결", message)

    def test_server_without_starttls_is_code_2(self):
        code, message = self.run_check(fake(starttls=False))
        self.assertEqual(code, 2)
        self.assertIn("STARTTLS", message)

    def test_missing_values_are_code_3_without_connecting(self):
        FakeSmtp.calls = []
        code, message = smtp_check.check("smtp.gmail.com", 587, "", SECRET, smtp_class=fake())
        self.assertEqual(code, 3)
        self.assertIn("POSEGOOD_MAIL_USERNAME", message)
        self.assertEqual(FakeSmtp.calls, [])


class FilesTest(unittest.TestCase):
    def write(self, text):
        handle = tempfile.NamedTemporaryFile("w", delete=False, encoding="utf-8")
        handle.write(text)
        handle.close()
        self.addCleanup(os.unlink, handle.name)
        return handle.name

    def test_env_last_value_wins_and_comments_are_skipped(self):
        path = self.write("# POSEGOOD_MAIL_HOST=old\nPOSEGOOD_MAIL_HOST=a\nPOSEGOOD_MAIL_HOST=\"b\"\n")
        self.assertEqual(smtp_check.read_env(path)["POSEGOOD_MAIL_HOST"], "b")

    def test_password_trailing_newline_is_removed_like_configtree(self):
        self.assertEqual(smtp_check.read_password(self.write("abc\n")), "abc")


if __name__ == "__main__":
    unittest.main()
