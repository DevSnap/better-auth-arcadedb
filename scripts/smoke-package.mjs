import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cp,
  lstat,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const npm = process.env.npm_execpath;
assert.ok(npm, "Run this smoke test with npm run test:package");
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const lock = JSON.parse(
  await readFile(join(root, "package-lock.json"), "utf8"),
);
const temporary = await mkdtemp(join(tmpdir(), "better-auth-arcadedb-smoke-"));

function runNpm(args, cwd) {
  execFileSync(process.execPath, [npm, ...args], {
    cwd,
    stdio: "inherit",
    timeout: 240_000,
    env: { ...process.env, NODE_PATH: "" },
  });
}

async function checkMaps(directory, installed) {
  let count = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      count += await checkMaps(path, installed);
    } else if (entry.name.endsWith(".d.ts.map")) {
      const map = JSON.parse(await readFile(path, "utf8"));
      assert.ok(map.sources.length > 0, `Empty declaration map: ${path}`);
      for (const source of map.sources) {
        const target = resolve(dirname(path), map.sourceRoot ?? "", source);
        const sourcePath = relative(join(installed, "src"), target);
        assert.ok(!sourcePath.startsWith("..") && !isAbsolute(sourcePath));
        assert.ok(
          (await stat(target)).isFile(),
          `Missing map source: ${target}`,
        );
      }
      count++;
    }
  }
  return count;
}

try {
  const outside = relative(await realpath(root), await realpath(temporary));
  assert.ok(outside.startsWith("..") || isAbsolute(outside));

  // npm pack runs prepack, including the clean build, and creates a real archive.
  runNpm(["pack", "--pack-destination", temporary], root);
  const archives = (await readdir(temporary)).filter((name) =>
    name.endsWith(".tgz"),
  );
  assert.equal(archives.length, 1);
  const dependencies = {
    [manifest.name]: `file:${join(temporary, archives[0])}`,
    // Better Auth imports bun:sqlite; load its real types without Bun globals.
    "bun-types": "1.4.3",
  };
  for (const name of Object.keys(manifest.peerDependencies)) {
    const version = manifest.devDependencies[name];
    assert.match(version, /^\d+\.\d+\.\d+$/, `Unpinned peer: ${name}`);
    dependencies[name] = version;
  }
  for (const name of ["typescript", "@types/node"]) {
    dependencies[name] = lock.packages[`node_modules/${name}`].version;
  }
  await writeFile(
    join(temporary, "package.json"),
    JSON.stringify({
      name: "arcadedb-tarball-consumer",
      private: true,
      type: "module",
      dependencies,
    }),
  );
  await writeFile(
    join(temporary, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2023",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        skipLibCheck: false,
        verbatimModuleSyntax: true,
        types: ["node", "bun-types/sqlite"],
        outDir: "build",
      },
      include: ["consumer.ts"],
    }),
  );
  await cp(
    new URL("./smoke-consumer.ts", import.meta.url),
    join(temporary, "consumer.ts"),
  );
  runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund"], temporary);
  const installed = join(temporary, "node_modules", manifest.name);
  assert.ok(!(await lstat(installed)).isSymbolicLink());
  assert.equal(await realpath(installed), installed);
  for (const file of ["CHANGELOG.md", "README.md", "LICENSE", "src/index.ts"]) {
    assert.ok((await stat(join(installed, file))).isFile());
  }
  const installedEntries = await readdir(installed);
  for (const excluded of ["tests", "examples", "scripts", ".github"]) {
    assert.ok(!installedEntries.includes(excluded), `Unexpected ${excluded}`);
  }
  assert.ok(await checkMaps(join(installed, "dist"), installed));
  execFileSync(
    process.execPath,
    [join(temporary, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"],
    { cwd: temporary, stdio: "inherit", timeout: 120_000 },
  );
  execFileSync(process.execPath, ["build/consumer.js"], {
    cwd: temporary,
    stdio: "inherit",
    timeout: 30_000,
    env: { ...process.env, NODE_PATH: "" },
  });
} finally {
  await rm(temporary, { recursive: true, force: true });
}
