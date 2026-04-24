from __future__ import annotations

import subprocess
import textwrap
import sys


REMOTE = "admin@162.105.14.34"
PASSWORD = "admin419"


remote_script = textwrap.dedent(
    r"""
    from pathlib import Path

    p = Path("/home/admin/model-downloader/app.py")
    text = p.read_text()
    orig = text

    text = text.replace(
        "import subprocess\nimport os\nimport uuid\nimport threading\nimport time\nimport re\n",
        "import subprocess\nimport os\nimport uuid\nimport threading\nimport time\nimport re\nimport json\nimport shlex\nimport urllib.request\n",
    )

    text = text.replace(
        "MODELSCOPE_CLI = \"/home/admin/.local/bin/modelscope\"\n\ndef _is_modelscope_id(s):\n",
        "MODELSCOPE_CLI = \"/home/admin/.local/bin/modelscope\"\nMODEL_REPO_FILE_CACHE = {}\nMODEL_REPO_FILE_CACHE_TTL = 300\n\ndef _is_modelscope_id(s):\n",
    )

    anchor = '''def _is_modelscope_id(s):\n    \"\"\"Check if this is a ModelScope model ID (org/name format)\"\"\"\n    return bool(re.match(r'^[a-zA-Z0-9_-]+/[a-zA-Z0-9_.-]+$', s))\n\n'''
    helper = '''def _fetch_modelscope_repo_file_paths(model_id):\n    # Fetch repository file paths from ModelScope so include can be resolved safely.\n    now = time.time()\n    cached = MODEL_REPO_FILE_CACHE.get(model_id)\n    if cached and now - cached[0] < MODEL_REPO_FILE_CACHE_TTL:\n        return cached[1]\n\n    url = f\"https://www.modelscope.cn/api/v1/models/{model_id}/repo/files?Revision=master&Recursive=True\"\n    try:\n        raw = urllib.request.urlopen(url, timeout=20).read().decode()\n        obj = json.loads(raw)\n        files = obj.get(\"Data\", {}).get(\"Files\", [])\n        paths = []\n        for item in files:\n            if isinstance(item, dict) and item.get(\"Type\") == \"blob\" and item.get(\"Path\"):\n                paths.append(item[\"Path\"])\n        MODEL_REPO_FILE_CACHE[model_id] = (now, paths)\n        return paths\n    except Exception:\n        MODEL_REPO_FILE_CACHE[model_id] = (now, [])\n        return []\n\n\ndef _resolve_modelscope_include(model_id, include):\n    # Resolve a file name to the most specific repo path when needed.\n    if not include:\n        return include\n\n    normalized = include.strip().strip('\"').strip(\"'\")\n    if normalized.startswith('./'):\n        normalized = normalized[2:]\n\n    if '/' in normalized:\n        return normalized\n\n    repo_paths = _fetch_modelscope_repo_file_paths(model_id)\n    if not repo_paths:\n        return normalized\n\n    candidates = [p for p in repo_paths if p == normalized or p.endswith('/' + normalized)]\n    if not candidates:\n        lower = normalized.lower()\n        candidates = [p for p in repo_paths if p.lower() == lower or p.lower().endswith('/' + lower)]\n\n    if not candidates:\n        return normalized\n\n    candidates.sort(key=lambda p: (0 if 'split_files/' in p else 1, len(p), p))\n    return candidates[0]\n\n'''

    if anchor not in text:
        raise SystemExit("helper anchor not found")
    text = text.replace(anchor, anchor + helper)

    old = '''    elif is_ms_id:\n        # ModelScope model ID -> modelscope CLI\n        local_dir = os.path.join(MODELS_BASE, target_subdir)\n        if include:\n            cmd = f\"{MODELSCOPE_CLI} download --model {model_id} --include '{include}' --local_dir {local_dir}\"\n        else:\n            cmd = f\"{MODELSCOPE_CLI} download --model {model_id} --local_dir {local_dir}\"\n'''
    new = '''    elif is_ms_id:\n        # ModelScope model ID -> modelscope CLI\n        local_dir = os.path.join(MODELS_BASE, target_subdir)\n        resolved_include = _resolve_modelscope_include(model_id, include)\n        tasks[task_id][\"resolved_include\"] = resolved_include\n        if include and resolved_include != include:\n            tasks[task_id][\"include_resolved_from\"] = include\n        if resolved_include:\n            cmd = f\"{MODELSCOPE_CLI} download --model {model_id} --include {shlex.quote(resolved_include)} --local_dir {shlex.quote(local_dir)}\"\n        else:\n            cmd = f\"{MODELSCOPE_CLI} download --model {model_id} --local_dir {shlex.quote(local_dir)}\"\n'''

    if old not in text:\n        raise SystemExit("modelscope block not found")\n    text = text.replace(old, new)\n\n    if text == orig:\n        print("No changes made")\n    else:\n        p.write_text(text)\n        print("patched")\n    """
)


def main() -> int:
    cmd = [
        "sshpass",
        "-p",
        PASSWORD,
        "ssh",
        "-o",
        "StrictHostKeyChecking=accept-new",
        REMOTE,
        "python3 -",
    ]
    proc = subprocess.run(cmd, input=remote_script, text=True, capture_output=True)
    sys.stdout.write(proc.stdout)
    sys.stderr.write(proc.stderr)
    return proc.returncode


if __name__ == "__main__":
    raise SystemExit(main())
