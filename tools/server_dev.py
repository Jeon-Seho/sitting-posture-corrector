"""Run the API, inference and the frontend proxy together for local development.

The API needs MySQL (ADR 0020): a disposable schema V2.6 database on the test MySQL server of
tools/test_mysql.py is created for the run and dropped afterwards.
"""

import time

if __package__:
    from .frontend_proxy import running_frontend_proxy
    from .service_processes import ServiceEndpoints, running_services
    from .test_mysql import disposable_database, mysql_server
else:
    from frontend_proxy import running_frontend_proxy
    from service_processes import ServiceEndpoints, running_services
    from test_mysql import disposable_database, mysql_server


def dev_server():
    endpoints = ServiceEndpoints.allocate()
    with mysql_server() as server, disposable_database(server) as database,             running_services(endpoints, database) as processes:
        frontend_processes = []
        with running_frontend_proxy(
            endpoints.api, processes, on_started=frontend_processes.append,
        ) as frontend:
            print(f"서버 연결 미리보기: {frontend}", flush=True)
            print("임시 DB의 합성 계정으로 가입한 뒤 측정하세요. 종료하면 DB를 지웁니다. 종료: Ctrl+C", flush=True)
            while all(process.poll() is None for process in [*processes, *frontend_processes]):
                time.sleep(0.25)
            raise RuntimeError("개발 서비스 또는 프론트가 종료되었습니다.")
