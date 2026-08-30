import datetime
import json
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
BUILD_JSON_PATH = os.path.join(PROJECT_ROOT, "build.json")
WINRES_JSON_PATH = os.path.join(PROJECT_ROOT, "winres", "winres.json")


def format_date(d):
    return d.strftime("%Y-%m-%d %H:%M:%S")


def update_winres(build_num, build_date):
    if not os.path.exists(WINRES_JSON_PATH):
        return
    try:
        with open(WINRES_JSON_PATH, "r", encoding="utf-8") as f:
            wdata = json.load(f)

        ver_str = f"1.0.0.{build_num}"

        # Update Manifest identity version
        if "RT_MANIFEST" in wdata and "#1" in wdata["RT_MANIFEST"]:
            manifest = wdata["RT_MANIFEST"]["#1"].get("0409", {})
            if "identity" in manifest:
                manifest["identity"]["version"] = ver_str

        # Update RT_VERSION fixed and info
        if "RT_VERSION" in wdata and "#1" in wdata["RT_VERSION"]:
            ver_obj = wdata["RT_VERSION"]["#1"].get("0000", {})
            if "fixed" in ver_obj:
                ver_obj["fixed"]["file_version"] = ver_str
                ver_obj["fixed"]["product_version"] = ver_str
            if "info" in ver_obj and "0409" in ver_obj["info"]:
                info = ver_obj["info"]["0409"]
                info["FileVersion"] = ver_str
                info["ProductVersion"] = ver_str
                info["Comments"] = f"Build #{build_num} ({build_date})"

        with open(WINRES_JSON_PATH, "w", encoding="utf-8") as f:
            json.dump(wdata, f, indent=2)
            f.write("\n")
    except Exception as e:
        print(f"[Aviso] Nao foi possivel atualizar winres.json: {e}")


def increment_build():
    data = {"build": 0, "date": ""}
    if os.path.exists(BUILD_JSON_PATH):
        try:
            with open(BUILD_JSON_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            data = {"build": 0, "date": ""}

    curr_build = data.get("build", 0)
    try:
        curr_build = int(curr_build)
    except (ValueError, TypeError):
        curr_build = 0

    data["build"] = curr_build + 1
    data["date"] = format_date(datetime.datetime.now())

    with open(BUILD_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")

    update_winres(data["build"], data["date"])

    print(f"[Build] Versao incrementada para Build #{data['build']} ({data['date']})")
    return data


if __name__ == "__main__":
    increment_build()
