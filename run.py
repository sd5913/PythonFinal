"""Start the LAN server and print candidate URLs for teammates."""
import argparse
import socket
import subprocess
import sys
import time
import webbrowser
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

import uvicorn


def is_game_server(url):
    try:
        with urlopen(url, timeout=1) as response:
            return b"PythonFinal" in response.read(65536)
    except (URLError, OSError):
        return False


def start_background(port, browser_url):
    url = "http://127.0.0.1:%s/" % port
    if is_game_server(url):
        print("大厅已在运行，正在打开浏览器。")
        webbrowser.open(browser_url)
        return
    root = Path(__file__).resolve().parent
    log_path = root / "server.log"
    with log_path.open("ab") as log:
        process = subprocess.Popen(
            [sys.executable, "-u", str(root / "run.py"), "--port", str(port)],
            cwd=str(root), stdin=subprocess.DEVNULL, stdout=log, stderr=log,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
            start_new_session=sys.platform != "win32",
        )
    for _ in range(40):
        if process.poll() is not None:
            raise SystemExit("大厅启动失败，请查看 %s" % log_path)
        if is_game_server(url):
            print("大厅已在后台启动。运行日志保存在 %s" % log_path)
            print("关闭浏览器不会停止服务。关闭服务电脑后需重新启动。")
            webbrowser.open(browser_url)
            return
        time.sleep(0.25)
    process.terminate()
    process.wait()
    raise SystemExit("等待大厅启动超时，请查看 %s" % log_path)


def main():
    parser = argparse.ArgumentParser(description="PythonFinal 局域网联机大厅")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--background", action="store_true", help="后台启动大厅并打开浏览器")
    args = parser.parse_args()
    print("\n本机浏览器：http://127.0.0.1:%s" % args.port)
    addresses = set(socket.gethostbyname_ex(socket.gethostname())[2])
    for address in sorted(addresses):
        if not address.startswith("127."):
            print("局域网候选地址：http://%s:%s" % (address, args.port))
    print("队友只需浏览器。请使用服务电脑当前 Wi-Fi 的 IPv4 地址，地址可能随网络变化。")
    if args.background:
        lan_addresses = sorted(address for address in addresses
                               if not address.startswith(("127.", "169.254.")))
        browser_url = "http://%s:%s/" % (lan_addresses[0], args.port) if len(lan_addresses) == 1 else "http://127.0.0.1:%s/" % args.port
        start_background(args.port, browser_url)
        return
    print("保持此窗口运行。按 Ctrl+C 停止后，内存中的房间会清空。\n")
    uvicorn.run("app.main:app", host="0.0.0.0", port=args.port, workers=1,
                ws_max_size=4096, ws_max_queue=16)


if __name__ == "__main__":
    main()
