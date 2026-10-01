"""Run the existing three services and frontend proxy together for local development."""

import time

if __package__:
    from .frontend_proxy import running_frontend_proxy
    from .service_processes import ServiceEndpoints, running_services
else:
    from frontend_proxy import running_frontend_proxy
    from service_processes import ServiceEndpoints, running_services


def dev_server():
    endpoints = ServiceEndpoints.allocate()
    with running_services(endpoints) as processes:
        frontend_processes = []
        with running_frontend_proxy(
            endpoints.api, processes, on_started=frontend_processes.append
        ) as frontend:
            print(f"서버 연결 미리보기: {frontend}", flush=True)
            print("측정 준비에서 ‘서버 판정 사용’을 선택하세요. 종료: Ctrl+C", flush=True)
            while all(process.poll() is None for process in [*processes, *frontend_processes]):
                time.sleep(0.25)
            raise RuntimeError("개발 서비스 또는 프론트가 종료되었습니다.")
