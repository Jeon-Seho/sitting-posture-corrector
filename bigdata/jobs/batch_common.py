"""Spark 배치(J1·J2·J3) 공통 — 설정, Spark 세션, 서비스 DB 읽기·쓰기 (아키텍처 v5.3 ㉘).

서버 PC의 spark 컨테이너에서 spark-submit으로 실행한다(tools/platform/batch.sh). DB 접속 값은 처리 서비스와 같은
infra/compose/.env 값을 컨테이너 환경 변수로 받는다: DB_HOST·DB_PORT·DB_USER·DB_PASSWORD·SERVICE_DB_SCHEMA.
MySQL JDBC 드라이버는 spark-submit --packages(com.mysql:mysql-connector-j)로 받는다.

시각: DB의 DATETIME은 모두 KST(한국 시각)다. 시간대 변환이 끼지 않도록 시각 계산은 SQL 안에서 끝내고
(세션 시작 기준 밀리초), Spark에는 숫자만 넘긴다. 날짜 경계도 KST 문자열('YYYY-MM-DD 00:00:00')로 비교한다.
로그에 이메일·좌표 같은 개인정보를 남기지 않는다(사용자 ID와 개수만).
"""

import datetime as dt
import os
import re
import sys
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")
MYSQL_DRIVER = "com.mysql.cj.jdbc.Driver"


def log(job, message):
    print(f"[{dt.datetime.now(KST):%Y-%m-%d %H:%M:%S}] {job} {message}", flush=True)


def now_kst_text():
    """DB DATETIME(3)에 넣을 지금 시각(KST)."""
    return dt.datetime.now(KST).strftime("%Y-%m-%d %H:%M:%S.%f")[:23]


def yesterday_kst():
    return dt.datetime.now(KST).date() - dt.timedelta(days=1)


def parse_date(text):
    return dt.date.fromisoformat(text)


def parse_users(text):
    """'12,34' → [12, 34]. 숫자만 받는다(SQL에 그대로 넣기 때문)."""
    if not text:
        return []
    users = [int(part) for part in text.split(",") if part.strip()]
    if any(user <= 0 for user in users):
        raise ValueError("user_account_id는 1 이상")
    return users


class DbConfig:
    """infra/compose/.env의 DB 값. 비밀번호는 출력하지 않는다."""

    def __init__(self, env=None):
        env = os.environ if env is None else env
        missing = [k for k in ("DB_HOST", "DB_USER", "DB_PASSWORD", "SERVICE_DB_SCHEMA") if not env.get(k)]
        if missing:
            raise SystemExit("DB 설정 없음: " + ", ".join(missing) + " — spark 컨테이너에 infra/compose/.env가 들어가는지 확인")
        self.host = env["DB_HOST"]
        self.port = int(env.get("DB_PORT") or 3306)
        self.user = env["DB_USER"]
        self.password = env["DB_PASSWORD"]
        self.schema = env["SERVICE_DB_SCHEMA"]
        if not re.fullmatch(r"[A-Za-z0-9_]+", self.schema):
            raise SystemExit("SERVICE_DB_SCHEMA는 영문·숫자·_만")

    @property
    def url(self):
        # 처리 서비스(backend/processing application.yml)와 같은 접속 옵션
        return (f"jdbc:mysql://{self.host}:{self.port}/{self.schema}"
                "?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=Asia/Seoul")


def spark_session(app_name):
    from pyspark.sql import SparkSession

    spark = (SparkSession.builder.appName(app_name)
             .config("spark.sql.session.timeZone", "Asia/Seoul")
             .config("spark.ui.showConsoleProgress", "false")
             .getOrCreate())
    spark.sparkContext.setLogLevel("WARN")
    return spark


def read_query(spark, db, sql):
    """SQL 결과를 DataFrame으로. 값은 호출하는 쪽이 검사한 숫자·날짜만 넣는다."""
    return (spark.read.format("jdbc")
            .option("url", db.url).option("driver", MYSQL_DRIVER)
            .option("user", db.user).option("password", db.password)
            .option("query", sql).load())


class Jdbc:
    """쓰기용 JDBC 연결(드라이버 JVM). Spark JDBC 쓰기는 upsert·삭제를 못 해서 직접 연결한다.

    DriverManager 대신 드라이버 객체로 연다 — --packages로 받은 드라이버는 DriverManager가 못 찾는 경우가 있다.
    with 블록 하나가 트랜잭션 하나다: 예외가 나면 rollback, 아니면 commit.
    """

    def __init__(self, spark, db):
        jvm = spark.sparkContext._jvm
        props = jvm.java.util.Properties()
        props.setProperty("user", db.user)
        props.setProperty("password", db.password)
        self.connection = jvm.com.mysql.cj.jdbc.Driver().connect(db.url, props)
        self.connection.setAutoCommit(False)

    def __enter__(self):
        return self

    def __exit__(self, kind, value, trace):
        try:
            if kind is None:
                self.connection.commit()
            else:
                self.connection.rollback()
        finally:
            self.connection.close()
        return False

    def _prepare(self, sql, params):
        statement = self.connection.prepareStatement(sql)
        for index, value in enumerate(params, start=1):
            if value is None:
                statement.setObject(index, None)
            elif isinstance(value, bool):
                statement.setBoolean(index, value)
            elif isinstance(value, int):
                statement.setLong(index, value)
            else:
                statement.setString(index, str(value))
        return statement

    def execute(self, sql, params=()):
        """바뀐 행 수를 돌려준다. 값은 ?로만 넘긴다."""
        statement = self._prepare(sql, params)
        try:
            return statement.executeUpdate()
        finally:
            statement.close()

    def query(self, sql, params=()):
        """행 목록(dict, 값은 문자열 또는 None). 숫자는 호출하는 쪽이 바꾼다."""
        statement = self._prepare(sql, params)
        try:
            result = statement.executeQuery()
            meta = result.getMetaData()
            names = [meta.getColumnLabel(i) for i in range(1, meta.getColumnCount() + 1)]
            rows = []
            while result.next():
                rows.append({name: result.getString(i) for i, name in enumerate(names, start=1)})
            result.close()
            return rows
        finally:
            statement.close()

    def commit(self):
        """with 블록 안에서 단계마다 확정할 때(J3 — 상태 바꾸기·파일 삭제 기록은 따로 확정)."""
        self.connection.commit()

    def rollback(self):
        self.connection.rollback()


HDFS_URI_DEFAULT = "hdfs://hdfs-namenode:9000"
USER_ROOT = "/data/users"


class Hdfs:
    """HDFS 파일 다루기(드라이버 JVM의 Hadoop FileSystem). 주소는 HDFS_URI(기본 hdfs://hdfs-namenode:9000)."""

    def __init__(self, spark, uri=None):
        jvm = spark.sparkContext._jvm
        self._jvm = jvm
        self.uri = uri or os.environ.get("HDFS_URI") or HDFS_URI_DEFAULT
        conf = spark.sparkContext._jsc.hadoopConfiguration()
        self.fs = jvm.org.apache.hadoop.fs.FileSystem.get(jvm.java.net.URI(self.uri), conf)

    def _path(self, path):
        return self._jvm.org.apache.hadoop.fs.Path(path)

    def exists(self, path):
        return bool(self.fs.exists(self._path(path)))

    def delete(self, path):
        """폴더째 지운다. 없으면 False(이미 지워짐 — 재시도에서 정상)."""
        return bool(self.fs.delete(self._path(path), True))

    def write_text(self, path, text):
        stream = self.fs.create(self._path(path), True)
        try:
            stream.write(bytearray(text.encode("utf-8")))
        finally:
            stream.close()


def user_folder(user_account_id):
    """사용자 폴더 /data/users/{user_account_id} — J1이 세션 폴더를 이 아래에 둔다(feature_archive.file_uri)."""
    return f"{USER_ROOT}/{int(user_account_id)}"


def fail(job, message, code=1):
    log(job, "FAIL " + message)
    sys.exit(code)
