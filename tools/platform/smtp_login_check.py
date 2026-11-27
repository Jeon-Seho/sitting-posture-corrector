#!/usr/bin/env python3
"""(D-110) io-api와 같은 값으로 SMTP 로그인만 시험한다 — 메일은 보내지 않고, 값(계정·비밀번호)은 출력하지 않는다.

io-api 설정(`backend/api` application.properties)과 같게:
  호스트 POSEGOOD_MAIL_HOST · 포트 POSEGOOD_MAIL_PORT(기본 587) · 아이디 POSEGOOD_MAIL_USERNAME(.env),
  비밀번호 infra/compose/secrets/spring.mail.password(끝 줄바꿈은 configtree처럼 뺀다), STARTTLS 필수.

통합 테스트 0단계가 비밀번호 재설정·가입 이메일 인증이 켜졌을 때 부른다. 11/25 운영 메일 실패(Gmail 앱 비밀번호가
아닌 값)를 0단계가 「파일이 비어 있지 않음」으로만 보고 지나친 것에 대한 재발 방지.

끝 코드: 0 로그인 성공 · 1 로그인 거절(아이디·비밀번호) · 2 연결·STARTTLS 실패 · 3 값 없음
표준 라이브러리만. 사용(저장소 루트): python3 -I tools/platform/smtp_login_check.py [--env-file …] [--password-file …]
"""

import argparse
import smtplib
import ssl
import sys

ENV_FILE = "infra/compose/.env"
PASSWORD_FILE = "infra/compose/secrets/spring.mail.password"
GMAIL_APP_PASSWORD_LENGTH = 16  # Google 앱 비밀번호는 공백을 뺀 영문 16자


def read_env(path):
    """KEY=값 줄만 읽는다(같은 키가 여러 번이면 마지막 값 — docker compose와 같음)."""
    values = {}
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def read_password(path):
    with open(path, encoding="utf-8") as handle:
        return handle.read().rstrip("\r\n")


def hint(host, password):
    """원인 짐작에 도움이 되는 사실만(값은 넣지 않는다)."""
    notes = [f"비밀번호 길이 {len(password)}"]
    if password != password.strip():
        notes.append("앞뒤 공백 있음")
    if (host or "").lower() == "smtp.gmail.com" and len(password.replace(" ", "")) != GMAIL_APP_PASSWORD_LENGTH:
        notes.append(f"Gmail 앱 비밀번호는 {GMAIL_APP_PASSWORD_LENGTH}자")
    return " · ".join(notes)


def check(host, port, user, password, timeout=10, smtp_class=smtplib.SMTP):
    """(끝 코드, 한 줄 설명). 설명에는 계정·비밀번호·서버 응답 원문을 넣지 않는다."""
    if not (host and user and password):
        missing = [name for name, value in (("POSEGOOD_MAIL_HOST", host), ("POSEGOOD_MAIL_USERNAME", user),
                                            ("spring.mail.password", password)) if not value]
        return 3, "값 없음: " + ", ".join(missing)
    step = "연결"
    try:
        with smtp_class(host, port, timeout=timeout) as smtp:
            step = "EHLO"
            smtp.ehlo()
            if not smtp.has_extn("starttls"):
                return 2, f"서버가 STARTTLS를 지원하지 않음(포트 {port}) — io-api는 STARTTLS 필수"
            step = "STARTTLS"
            smtp.starttls(context=ssl.create_default_context())
            smtp.ehlo()
            step = "로그인"
            smtp.login(user, password)
        return 0, f"STARTTLS·로그인 성공(포트 {port}, 메일은 보내지 않음)"
    except smtplib.SMTPAuthenticationError as error:
        return 1, f"로그인 거절 {error.smtp_code} — {hint(host, password)}"
    except smtplib.SMTPServerDisconnected:
        if step == "로그인":  # Gmail은 틀린 비밀번호에 연결을 끊기도 한다(11/25·11/26 서버)
            return 1, f"로그인 단계에서 서버가 연결을 끊음 — {hint(host, password)}"
        return 2, f"{step} 단계에서 서버가 연결을 끊음"
    except (OSError, smtplib.SMTPException) as error:
        return 2, f"{step} 단계 실패: {type(error).__name__}"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--env-file", default=ENV_FILE)
    parser.add_argument("--password-file", default=PASSWORD_FILE)
    parser.add_argument("--timeout", type=float, default=10)
    args = parser.parse_args(argv)
    try:
        env = read_env(args.env_file)
        password = read_password(args.password_file)
    except OSError as error:
        print(f"파일을 읽지 못함: {type(error).__name__}")
        return 3
    try:
        port = int(env.get("POSEGOOD_MAIL_PORT") or 587)
    except ValueError:
        print("POSEGOOD_MAIL_PORT가 숫자가 아님")
        return 3
    code, message = check(env.get("POSEGOOD_MAIL_HOST"), port, env.get("POSEGOOD_MAIL_USERNAME"),
                          password, timeout=args.timeout)
    print(message)
    return code


if __name__ == "__main__":
    sys.exit(main())
