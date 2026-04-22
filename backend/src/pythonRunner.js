const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const pythonCandidates = [process.env.PYTHON_EXECUTABLE, "py", "python"].filter(Boolean);

function isMissingInterpreter(result) {
  return (
    result.exitCode === 9009 ||
    /python was not found/i.test(result.stderr) ||
    /not recognized as an internal or external command/i.test(result.stderr)
  );
}

async function writeWorkspace(tempDir, files) {
  await Promise.all(
    Object.entries(files).map(async ([filename, content]) => {
      const filepath = path.join(tempDir, filename);
      await fs.mkdir(path.dirname(filepath), { recursive: true });
      await fs.writeFile(filepath, content, "utf8");
    })
  );
}

function runProcess(command, args, cwd, stdin) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    let finished = false;

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        child.kill();
        resolve({
          ok: false,
          stdout,
          stderr: `${stderr}\nExecution timed out after 5 seconds.`.trim(),
          exitCode: -1
        });
      }
    }, 5000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);

    child.on("close", (exitCode) => {
      if (finished) {
        return;
      }

      clearTimeout(timer);
      finished = true;
      resolve({
        ok: exitCode === 0,
        stdout,
        stderr,
        exitCode
      });
    });

    if (stdin) {
      child.stdin.write(stdin);
    }

    child.stdin.end();
  });
}

async function runPythonWorkspace(files, stdin = "") {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cloudide-secure-"));

  try {
    await writeWorkspace(tempDir, files);

    let lastError = null;
    for (const candidate of pythonCandidates) {
      try {
        const args = candidate === "py" ? ["-3", "main.py"] : ["main.py"];
        const result = await runProcess(candidate, args, tempDir, stdin);

        if (isMissingInterpreter(result)) {
          continue;
        }

        return {
          ...result,
          command: [candidate, ...args].join(" ")
        };
      } catch (error) {
        lastError = error;
      }
    }

    return {
      ok: false,
      stdout: "",
      stderr: `Python runtime not available. Last error: ${lastError?.message || "unknown"}`,
      exitCode: -1,
      command: null
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

module.exports = {
  runPythonWorkspace
};
