import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.request

# Configura saida padrao do console para UTF-8 sem falhas de encoding no Windows
if sys.stdout.encoding != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILENAME = "release_ai_config.json"
CONFIG_EXAMPLE_FILENAME = "release_ai_config.example.json"


def get_git_remote_repo():
    """Detecta automaticamente o repositorio GitHub configurado no Git remoto (origin)."""
    try:
        cmd = ["git", "config", "--get", "remote.origin.url"]
        res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", cwd=SCRIPT_DIR)
        if res.returncode == 0 and res.stdout.strip():
            url = res.stdout.strip()
            match = re.search(r"github\.com[:/]([^/]+/[^/]+?)(?:\.git)?$", url)
            if match:
                return match.group(1)
    except Exception:
        pass
    return ""


def get_project_metadata():
    """Obtem metadados do projeto a partir de manifestos padrao (package.json, build.json)."""
    meta = {
        "name": "",
        "description": "",
        "version": "",
    }

    # 1. Tenta carregar do package.json
    pkg_path = os.path.join(SCRIPT_DIR, "package.json")
    if os.path.exists(pkg_path):
        try:
            with open(pkg_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                meta["name"] = str(data.get("name", "")).strip()
                meta["description"] = str(data.get("description", "")).strip()
                meta["version"] = str(data.get("version", "")).strip()
        except Exception:
            pass

    # 2. Tenta complementar ou sobrescrever pelo build.json
    build_path = os.path.join(SCRIPT_DIR, "build.json")
    if os.path.exists(build_path):
        try:
            with open(build_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                ver = data.get("version") or data.get("build")
                if ver:
                    meta["version"] = str(ver).strip()
                if not meta["name"] and data.get("name"):
                    meta["name"] = str(data.get("name")).strip()
        except Exception:
            pass

    if not meta["name"]:
        meta["name"] = os.path.basename(os.path.abspath(SCRIPT_DIR))
    if not meta["version"]:
        meta["version"] = "1.0.0"

    return meta


def load_config():
    """Carrega as configuracoes a partir do arquivo JSON, metadados ou variaveis de ambiente."""
    meta = get_project_metadata()
    detected_repo = get_git_remote_repo()

    config = {
        "app_name": meta.get("name", "Application"),
        "app_description": meta.get("description", ""),
        "github_repo": detected_repo,
        "api_url": "http://127.0.0.1:8045/v1/chat/completions",
        "api_key": "",
        "model_name": "gemini-2.5-flash",
        "temperature": 0.3,
        "timeout_seconds": 30,
        "commit_limit": 30,
        "cleanup_keep_releases": 3,
        "tag_prefix": "v",
        "asset_paths": [],
        "custom_prompt": "",
    }

    config_paths = [
        os.path.join(SCRIPT_DIR, CONFIG_FILENAME),
        os.path.join(os.getcwd(), CONFIG_FILENAME),
    ]

    config_found = False
    for path in config_paths:
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    config.update(data)
                    config_found = True
                    break
            except Exception as e:
                print(f"[Aviso] Erro ao ler '{path}': {e}")

    # Permite sobrescrever via variaveis de ambiente
    if os.getenv("APP_NAME"):
        config["app_name"] = os.getenv("APP_NAME")
    if os.getenv("APP_DESCRIPTION"):
        config["app_description"] = os.getenv("APP_DESCRIPTION")
    if os.getenv("GITHUB_REPO"):
        config["github_repo"] = os.getenv("GITHUB_REPO")
    if os.getenv("AI_API_URL"):
        config["api_url"] = os.getenv("AI_API_URL")
    if os.getenv("AI_API_KEY"):
        config["api_key"] = os.getenv("AI_API_KEY")
    if os.getenv("AI_MODEL_NAME"):
        config["model_name"] = os.getenv("AI_MODEL_NAME")

    if not config_found and not config.get("api_key"):
        print(f"[Info] Arquivo '{CONFIG_FILENAME}' nao encontrado. Copie '{CONFIG_EXAMPLE_FILENAME}' para customizar.")

    return config


def get_git_commits(limit=30):
    """Obtem o historico recente de commits do Git."""
    try:
        cmd = [
            "git",
            "log",
            f"-{limit}",
            "--pretty=format:* %s (%ad)",
            "--date=short",
        ]
        result = subprocess.run(
            cmd, capture_output=True, text=True, encoding="utf-8", cwd=SCRIPT_DIR
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    except Exception as e:
        print(f"[Aviso] Nao foi possivel obter commits do git: {e}")
    return ""


def get_version(config):
    """Obtem a versao do projeto."""
    meta = get_project_metadata()
    return meta.get("version", "1.0.0")


def generate_notes_with_ai(version_label, commits, config):
    """Envia os commits para a IA gerar notas de lancamento formatadas."""
    api_url = config.get("api_url")
    api_key = config.get("api_key", "").strip()
    model_name = config.get("model_name", "gemini-2.5-flash")
    temperature = config.get("temperature", 0.3)
    timeout = config.get("timeout_seconds", 30)

    if not api_key or api_key in ("SEU_API_KEY_AQUI", "YOUR_API_KEY_HERE"):
        raise ValueError("Chave de API nao configurada no release_ai_config.json")

    app_name = config.get("app_name", "Application")
    app_desc = config.get("app_description", "").strip()
    desc_clause = f" ({app_desc})" if app_desc else ""

    custom_prompt = config.get("custom_prompt", "").strip()
    if custom_prompt:
        try:
            prompt = custom_prompt.format(
                app_name=app_name,
                app_description=app_desc,
                version=version_label,
                commits=commits,
            )
        except Exception:
            prompt = custom_prompt
    else:
        prompt = f"""Você é um assistente de engenharia de software criando Release Notes (Notas de Lançamento) para o aplicativo {app_name}{desc_clause}.

Abaixo está o histórico dos últimos commits do projeto:
{commits}

Tarefa:
Gere uma descrição resumida, profissional e organizada em Markdown para o lançamento da versão **{version_label}**.
- Destaque as principais melhorias, novos recursos e correções de bugs.
- Agrupe em tópicos objetivos (ex: 🚀 Novidades e Recursos, 🎨 Interface e Usabilidade, 🛠️ Correções e Melhorias).
- Seja direto e amigável para o usuário final. Não mencione hashes de commit.
- Responda apenas com o conteúdo em Markdown (sem blocos ```markdown envolvendo todo o texto)."""

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }

    payload = {
        "model": model_name,
        "messages": [
            {
                "role": "system",
                "content": "Você é um gerador técnico de release notes objetivo e preciso.",
            },
            {"role": "user", "content": prompt},
        ],
        "temperature": temperature,
    }

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(api_url, data=data, headers=headers)

    with urllib.request.urlopen(req, timeout=timeout) as resp:
        res = json.loads(resp.read().decode("utf-8"))
        content = res["choices"][0]["message"]["content"].strip()
        if content.startswith("```markdown"):
            content = content[len("```markdown") :].strip()
        elif content.startswith("```"):
            content = content[3:].strip()
        if content.endswith("```"):
            content = content[:-3].strip()
        return content


def get_available_assets(config):
    """Identifica quais arquivos binarios/assets definidos na config estao disponiveis."""
    asset_paths = config.get("asset_paths", [])
    valid_assets = []
    for rel_path in asset_paths:
        full_path = os.path.join(SCRIPT_DIR, rel_path)
        if os.path.exists(full_path):
            valid_assets.append(full_path)
    return valid_assets


def check_gh_installed():
    """Verifica se o utilitario GitHub CLI (gh) esta disponivel no sistema."""
    return shutil.which("gh") is not None


def publish_github_release(tag, title, notes_path, config, draft=False, prerelease=False):
    """Cria a release no GitHub e faz upload dos arquivos binarios usando gh CLI."""
    if not check_gh_installed():
        print("[Erro] O utilitario GitHub CLI ('gh') nao foi encontrado no sistema.")
        print("Instale o GitHub CLI ou verifique o PATH: https://cli.github.com/")
        return False

    repo = config.get("github_repo", "").strip()
    assets = get_available_assets(config)

    print(f"\nPublicando Release '{tag}' no GitHub...")
    if repo:
        print(f"Repositorio: {repo}")
    if assets:
        print("Assets encontrados para anexo:")
        for a in assets:
            print(f"  - {os.path.relpath(a, SCRIPT_DIR)}")
    else:
        print("[Info] Nenhum arquivo binario anexado.")

    cmd = ["gh", "release", "create", tag]
    cmd.extend(assets)
    cmd.extend(["--title", title, "--notes-file", notes_path])

    if repo:
        cmd.extend(["--repo", repo])
    if draft:
        cmd.append("--draft")
    if prerelease:
        cmd.append("--prerelease")

    try:
        res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", cwd=SCRIPT_DIR)
        if res.returncode == 0:
            print(f"[OK] Release {tag} publicada com sucesso no GitHub!")
            if res.stdout.strip():
                print(f"URL: {res.stdout.strip()}")
            return True
        else:
            print(f"[Erro] Falha ao criar release no GitHub:\n{res.stderr.strip()}")
            return False
    except Exception as e:
        print(f"[Erro] Excecao ao executar gh release create: {e}")
        return False


def cleanup_old_releases(keep=3, repo=None):
    """Remove releases antigas mantendo apenas as N mais recentes."""
    if not check_gh_installed():
        return

    print(f"\nVerificando releases no GitHub para manter apenas as {keep} ultimas...")
    try:
        cmd = ["gh", "release", "list", "--limit", "100", "--json", "tagName"]
        if repo:
            cmd.extend(["--repo", repo])

        res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", cwd=SCRIPT_DIR)
        if res.returncode == 0 and res.stdout.strip():
            releases = json.loads(res.stdout)
            if len(releases) > keep:
                to_delete = releases[keep:]
                for rel in to_delete:
                    tag = rel.get("tagName")
                    if tag:
                        print(f"Removendo release antiga: {tag}...")
                        del_cmd = ["gh", "release", "delete", tag, "--yes", "--cleanup-tag"]
                        if repo:
                            del_cmd.extend(["--repo", repo])
                        subprocess.run(del_cmd, capture_output=True, cwd=SCRIPT_DIR)
                print(f"[OK] Limpeza concluida! Mantidas as {keep} releases mais recentes.")
            else:
                print(f"[OK] Total de releases ({len(releases)}) ja esta dentro do limite (<= {keep}).")
    except Exception as e:
        print(f"[Aviso] Falha na limpeza de releases antigas: {e}")


def main():
    parser = argparse.ArgumentParser(description="Gerador de Release Notes com IA e publicador de releases no GitHub.")
    parser.add_argument("--publish", "-p", action="store_true", help="Gera notas e publica a release no GitHub com assets.")
    parser.add_argument("--tag", type=str, help="Tag da release (ex: v1.0.0). Se omitido, usa a versao do manifesto.")
    parser.add_argument("--title", type=str, help="Titulo da release.")
    parser.add_argument("--repo", type=str, help="Repositorio no GitHub no formato 'usuario/repo' (ex: usuario/projeto).")
    parser.add_argument("--draft", action="store_true", help="Publica como rascunho (draft).")
    parser.add_argument("--prerelease", action="store_true", help="Publica como pre-release.")
    parser.add_argument("--cleanup-only", action="store_true", help="Apenas executa a limpeza de releases antigas.")
    parser.add_argument("--no-cleanup", action="store_true", help="Nao executa limpeza de releases antigas apos publicar.")

    args = parser.parse_args()
    config = load_config()

    if args.repo:
        config["github_repo"] = args.repo

    repo = config.get("github_repo")
    cleanup_keep = config.get("cleanup_keep_releases", 3)
    commit_limit = config.get("commit_limit", 30)
    tag_prefix = config.get("tag_prefix", "v")
    app_name = config.get("app_name", "Application")

    if args.cleanup_only:
        cleanup_old_releases(cleanup_keep, repo=repo)
        return

    # Determinando versao e tag
    raw_version = get_version(config)
    tag = args.tag or (f"{tag_prefix}{raw_version}" if not raw_version.startswith(tag_prefix) else raw_version)
    title = args.title or f"{app_name} {tag}"

    commits = get_git_commits(commit_limit)

    print(f"Gerando Release Notes com IA para {tag} ({app_name})...")

    notes = ""
    try:
        if commits:
            notes = generate_notes_with_ai(tag, commits, config)
            print("[OK] Release Notes geradas pela IA com sucesso!")
        else:
            notes = f"Release oficial do {app_name} - {tag}"
    except Exception as e:
        print(f"[Aviso] Falha ao conectar a IA ({e}). Usando fallback automatico.")
        if commits:
            notes = f"### {app_name} - {tag}\n\n**Commits recentes:**\n{commits}"
        else:
            notes = f"Release oficial do {app_name} - {tag}"

    output_file = os.path.join(SCRIPT_DIR, "release_notes.txt")
    with open(output_file, "w", encoding="utf-8") as f:
        f.write(notes)

    print(f"\n--- Previa das Release Notes ({tag}) ---")
    print(notes)
    print("----------------------------------------\n")
    print(f"[OK] Arquivo salvo em: {output_file}")

    # Publicacao no GitHub
    should_publish = args.publish

    if not should_publish and sys.stdin.isatty():
        try:
            choice = input(f"Deseja publicar a release {tag} no GitHub agora? (s/N): ").strip().lower()
            if choice in ("s", "sim", "y", "yes"):
                should_publish = True
        except (EOFError, KeyboardInterrupt):
            pass

    if should_publish:
        published = publish_github_release(
            tag=tag,
            title=title,
            notes_path=output_file,
            config=config,
            draft=args.draft,
            prerelease=args.prerelease,
        )
        if published and not args.no_cleanup:
            cleanup_old_releases(cleanup_keep, repo=repo)
    else:
        print("\nPara publicar esta release no GitHub com os binarios anexados, execute:")
        print(f"  python generate_release_notes.py --publish")


if __name__ == "__main__":
    main()


