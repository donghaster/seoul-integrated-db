# -*- coding: utf-8 -*-
"""
GitHub Actions 자동 갱신에 필요한 시크릿을 등록한다.

로컬 .env에서 키를 읽어 `gh secret set`에 **표준입력으로** 흘려보낸다.
키 값은 화면에도, 로그에도, 명령행 인자에도 남지 않는다.

실행:
  py tools/setup_secrets.py            # 등록
  py tools/setup_secrets.py --check    # 준비 상태만 점검(키 건드리지 않음)
"""
from __future__ import annotations

import os
import subprocess
import sys

# 윈도우 한글 콘솔(cp949)은 gh가 뱉는 체크표시(✓) 같은 글자를 못 찍고 죽는다.
# 실제로 --check가 UnicodeEncodeError로 멈췄다. 못 찍는 글자는 물음표로 흘린다.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(errors="replace")
    except Exception:          # noqa: BLE001 - 못 바꿔도 아래 safe()가 대부분 막는다
        pass


def safe(text) -> str:
    """콘솔이 못 찍는 글자를 미리 걷어낸다. gh 출력은 무엇이 섞여 올지 모른다."""
    enc = sys.stdout.encoding or "utf-8"
    return str(text).encode(enc, "replace").decode(enc, "replace")


BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIBLING_ENV = os.path.join(os.path.dirname(BASE_DIR), "seoul dashboard", ".env")
REPO = os.environ.get("GH_REPO", "donghaster/seoul-integrated-db")

# (시크릿 이름, 없으면 치명적인가)
NEEDED = [
    ("DATA_GO_KR_KEY", True),    # 국토교통부 실거래가 — 없으면 갱신 자체가 불가
    ("KAKAO_REST_KEY", False),   # 지오코딩 — 없으면 기존 좌표만 사용
    ("SEOUL_OPEN_DATA_KEY", False),  # 서울 상권분석 — 없으면 상권 대시보드가 안 갱신된다
]


def env_paths() -> list[str]:
    return [os.path.join(BASE_DIR, ".env"), SIBLING_ENV]


def read_keys() -> tuple[dict[str, str], str | None]:
    """.env에서 키를 읽는다. 값은 호출한 쪽에서도 절대 출력하지 않는다."""
    for path in env_paths():
        if not os.path.exists(path):
            continue
        found: dict[str, str] = {}
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k, v = k.strip(), v.strip()
                if v:
                    found[k] = v
        if found:
            return found, path
    return {}, None


def run(args: list[str], stdin_text: str | None = None) -> tuple[int, str]:
    p = subprocess.run(
        args, input=stdin_text, text=True, encoding="utf-8",
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    return p.returncode, (p.stdout or "").strip()


def check_gh() -> bool:
    code, out = run(["gh", "auth", "status"])
    if code != 0:
        print("  ! GitHub CLI 로그인이 안 돼 있습니다. 먼저 `gh auth login`을 실행하세요.")
        print("   ", safe(out.splitlines()[0]) if out else "")
        return False
    who = "?"
    for line in out.splitlines():
        if "Logged in to" in line:
            who = line.strip()
            break
    print(safe(f"  GitHub CLI: {who}"))
    return True


def main() -> int:
    check_only = "--check" in sys.argv

    print(f"저장소: {REPO}")

    if not check_gh():
        return 1

    code, out = run(["gh", "repo", "view", REPO, "--json", "name", "-q", ".name"])
    if code != 0:
        print(safe(f"  ! 저장소에 접근할 수 없습니다: {out}"))
        return 1
    print(f"  저장소 접근 OK")

    keys, path = read_keys()
    if not keys:
        print("  ! .env를 찾지 못했습니다. 다음 위치 중 하나에 키를 두세요:")
        for p in env_paths():
            print(f"     - {p}")
        return 1
    print(f"  키 파일: {path}")

    missing_required = False
    for name, required in NEEDED:
        have = name in keys
        mark = "있음" if have else ("없음(필수)" if required else "없음(선택)")
        print(f"    {name}: {mark}")
        if required and not have:
            missing_required = True
    if missing_required:
        print("  ! 필수 키가 없어 중단합니다.")
        return 1

    if check_only:
        print("\n점검만 수행했습니다. 실제 등록은 --check 없이 다시 실행하세요.")
        return 0

    print("\n시크릿 등록 중… (값은 표준입력으로만 전달되어 어디에도 남지 않습니다)")
    failed = False
    for name, _ in NEEDED:
        if name not in keys:
            continue
        code, out = run(["gh", "secret", "set", name, "--repo", REPO], stdin_text=keys[name])
        if code == 0:
            print(f"    {name} 등록 완료")
        else:
            failed = True
            print(safe(f"    {name} 등록 실패: {out}"))

    if failed:
        return 1

    print("\n등록된 시크릿 목록:")
    code, out = run(["gh", "secret", "list", "--repo", REPO])
    print("   ", safe(out.replace("\n", "\n    ")) if out else "(없음)")

    print("\n이제 다음 명령으로 자동 갱신을 즉시 돌려볼 수 있습니다:")
    print(f"    gh workflow run refresh-data.yml --repo {REPO}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
