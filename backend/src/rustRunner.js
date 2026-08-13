const fs = require("fs/promises");
const fsSync = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

function getRustCandidates() {
  return [process.env.RUSTC_EXECUTABLE, "rustc"].filter(Boolean);
}

let cachedVcvarsPath;
let cachedMingwLinkers;

function quoteForCmd(value) {
  const text = String(value ?? "");
  const escaped = text.replace(/"/g, '""');
  return `"${escaped}"`;
}

function findVswhereExecutable() {
  const candidates = [
    "C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe",
    "C:\\Program Files\\Microsoft Visual Studio\\Installer\\vswhere.exe"
  ];

  return candidates.find((candidate) => fsSync.existsSync(candidate)) || null;
}

function findVcvars64() {
  if (cachedVcvarsPath !== undefined) {
    return cachedVcvarsPath;
  }

  const envCandidate = process.env.VCVARS64_BAT;
  if (envCandidate && fsSync.existsSync(envCandidate)) {
    cachedVcvarsPath = envCandidate;
    return cachedVcvarsPath;
  }

  const editions = ["BuildTools", "Community", "Professional", "Enterprise"];
  const years = ["2022", "2019"];
  const roots = ["C:\\Program Files\\Microsoft Visual Studio", "C:\\Program Files (x86)\\Microsoft Visual Studio"];

  for (const root of roots) {
    for (const year of years) {
      for (const edition of editions) {
        const candidate = path.join(root, year, edition, "VC", "Auxiliary", "Build", "vcvars64.bat");
        if (fsSync.existsSync(candidate)) {
          cachedVcvarsPath = candidate;
          return cachedVcvarsPath;
        }
      }
    }
  }

  const vswherePath = findVswhereExecutable();
  if (vswherePath) {
    const vswhereResult = spawnSync(
      vswherePath,
      ["-latest", "-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"],
      { encoding: "utf8", windowsHide: true }
    );

    const installPath = String(vswhereResult.stdout || "").trim();
    if (installPath) {
      const candidate = path.join(installPath, "VC", "Auxiliary", "Build", "vcvars64.bat");
      if (fsSync.existsSync(candidate)) {
        cachedVcvarsPath = candidate;
        return cachedVcvarsPath;
      }
    }
  }

  cachedVcvarsPath = null;
  return cachedVcvarsPath;
}

function getMingwLinkerCandidates() {
  if (cachedMingwLinkers) {
    return cachedMingwLinkers;
  }

  const envLinker = process.env.RUST_GNU_LINKER;
  const defaults = [
    envLinker,
    "C:\\Users\\PC\\AppData\\Local\\Microsoft\\WinGet\\Packages\\BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\\mingw64\\bin\\x86_64-w64-mingw32-gcc.exe",
    "x86_64-w64-mingw32-gcc"
  ].filter(Boolean);

  cachedMingwLinkers = defaults.filter((linker, index) => defaults.indexOf(linker) === index);
  return cachedMingwLinkers;
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

function runProcess(command, args, cwd, stdin = "", timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    let finished = false;
    let timedOut = false;

    const stopProcessTree = () => {
      if (process.platform === "win32" && child.pid) {
        spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true
        });
        return;
      }
      child.kill("SIGKILL");
    };

    const timer = setTimeout(() => {
      if (!finished) {
        timedOut = true;
        stopProcessTree();
      }
    }, timeoutMs);

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
        ok: !timedOut && exitCode === 0,
        stdout,
        stderr: timedOut
          ? `${stderr}\nExecution timed out after ${Math.floor(timeoutMs / 1000)} seconds.`.trim()
          : stderr,
        exitCode: timedOut ? -1 : exitCode
      });
    });

    if (stdin) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}

function isMissingRustCompiler(result) {
  return (
    result.exitCode === 9009 ||
    /'rustc' is not recognized/i.test(result.stderr) ||
    /could not find/i.test(result.stderr)
  );
}

function humanizeRustCompileError(stderr = "") {
  const text = String(stderr || "");

  if (/linker `link\.exe` not found/i.test(text) || /msvc linker/i.test(text)) {
    return [
      "Rust toolchain is installed, but Windows C++ linker is missing.",
      "Install Visual Studio Build Tools with C++ workload, then restart the backend.",
      "Raw compiler output:",
      text.trim()
    ].join("\n\n");
  }

  return text;
}

function findEntrypoint(files = {}) {
  if (Object.prototype.hasOwnProperty.call(files, "src/main.rs")) {
    return "src/main.rs";
  }
  if (Object.prototype.hasOwnProperty.call(files, "main.rs")) {
    return "main.rs";
  }
  return "src/main.rs";
}

async function compileRust(candidate, compileArgs, tempDir) {
  const vcvars64 = findVcvars64();

  if (vcvars64) {
    const commandText = [candidate, ...compileArgs].map(quoteForCmd).join(" ");
    const bootstrapAndCompile = `call ${quoteForCmd(vcvars64)} >nul 2>nul && ${commandText}`;
    const result = await runProcess("cmd.exe", ["/d", "/s", "/c", bootstrapAndCompile], tempDir, "", 20000);
    return {
      result,
      command: `${candidate} ${compileArgs.join(" ")}`
    };
  }

  const result = await runProcess(candidate, compileArgs, tempDir, "", 15000);
  return {
    result,
    command: `${candidate} ${compileArgs.join(" ")}`
  };
}

function isMissingMsvcLinker(stderr = "") {
  const text = String(stderr || "");
  return /linker `link\.exe` not found/i.test(text) || /msvc linker/i.test(text);
}

async function compileRustWithGnuTarget(candidate, entry, outputExe, tempDir) {
  let lastError = null;

  for (const linker of getMingwLinkerCandidates()) {
    try {
      const compileArgs = [
        "--target",
        "x86_64-pc-windows-gnu",
        "-C",
        `linker=${linker}`,
        entry,
        "-o",
        outputExe
      ];
      const result = await runProcess(candidate, compileArgs, tempDir, "", 20000);

      if (isMissingRustCompiler(result)) {
        continue;
      }

      if (result.ok) {
        return {
          ok: true,
          result,
          command: `${candidate} ${compileArgs.join(" ")}`
        };
      }

      lastError = result;
    } catch (error) {
      lastError = {
        ok: false,
        stdout: "",
        stderr: error?.message || "GNU target compile failed.",
        exitCode: -1
      };
    }
  }

  return {
    ok: false,
    result: lastError || {
      ok: false,
      stdout: "",
      stderr: "GNU linker not found for Rust fallback target.",
      exitCode: -1
    },
    command: `${candidate} --target x86_64-pc-windows-gnu ...`
  };
}

async function runRustWorkspace(files, stdin = "") {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cloudide-secure-rust-"));

  try {
    await writeWorkspace(tempDir, files);
    const entry = findEntrypoint(files);
    const outputExe = path.join(tempDir, "program.exe");

    let lastError = null;
    for (const candidate of getRustCandidates()) {
      try {
        const compileArgs = [entry, "-o", outputExe];
        const { result: compileResult, command: compileCommand } = await compileRust(candidate, compileArgs, tempDir);

        if (isMissingRustCompiler(compileResult)) {
          continue;
        }

        if (!compileResult.ok) {
          if (isMissingMsvcLinker(compileResult.stderr)) {
            const gnuCompile = await compileRustWithGnuTarget(candidate, entry, outputExe, tempDir);
            if (gnuCompile.ok) {
              const runResult = await runProcess(outputExe, [], tempDir, stdin, 7000);
              return {
                ...runResult,
                command: gnuCompile.command + " && " + outputExe
              };
            }
          }

          return {
            ok: false,
            stdout: compileResult.stdout,
            stderr: humanizeRustCompileError(compileResult.stderr) || "Rust compilation failed.",
            exitCode: compileResult.exitCode,
            command: compileCommand
          };
        }

        const runResult = await runProcess(outputExe, [], tempDir, stdin, 7000);
        return {
          ...runResult,
          command: compileCommand + " && " + outputExe
        };
      } catch (error) {
        lastError = error;
      }
    }

    return {
      ok: false,
      stdout: "",
      stderr: `Rust compiler not available. Install Rust and ensure 'rustc' is on PATH. Last error: ${lastError?.message || "unknown"}`,
      exitCode: -1,
      command: null
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

module.exports = {
  runRustWorkspace
};
