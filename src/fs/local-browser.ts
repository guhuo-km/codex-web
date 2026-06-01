import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { basename, dirname, parse, resolve } from "node:path";
import { platform } from "node:process";

export interface FsRoot {
  name: string;
  path: string;
}

export interface FsEntry {
  name: string;
  path: string;
  type: "directory";
}

export interface FsDirectoryListing {
  path: string;
  name: string;
  parentPath?: string;
  roots: FsRoot[];
  entries: FsEntry[];
}

export function listRoots(): FsRoot[] {
  if (platform === "win32") {
    const roots: FsRoot[] = [];
    for (let code = 65; code <= 90; code += 1) {
      const letter = String.fromCharCode(code);
      const drivePath = `${letter}:\\`;
      if (existsSync(drivePath)) {
        roots.push({ name: `${letter}:`, path: drivePath });
      }
    }
    return roots;
  }
  return [{ name: "/", path: "/" }];
}

export async function listDirectory(pathInput?: string): Promise<FsDirectoryListing> {
  const roots = listRoots();
  const target = pathInput?.trim() ? resolve(pathInput) : roots[0]?.path ?? process.cwd();
  const entries = await readdir(target, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    error.message = `Cannot read directory ${target}: ${error.message}`;
    throw error;
  });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      path: resolve(target, entry.name),
      type: "directory" as const
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  const parsed = parse(target);
  const parent = dirname(target);

  return {
    path: target,
    name: basename(target) || parsed.root || target,
    parentPath: parent !== target ? parent : undefined,
    roots,
    entries: directories
  };
}

export async function createDirectory(parentInput: string, nameInput: string, protectedPaths: string[] = []): Promise<FsDirectoryListing> {
  const parent = resolve(parentInput);
  assertSafeDirectoryName(nameInput);
  const target = resolve(parent, nameInput.trim());
  assertInsideParent(parent, target);
  assertNotProtected(target, protectedPaths);
  await mkdir(target);
  return listDirectory(parent);
}

export async function renameDirectory(pathInput: string, nameInput: string, protectedPaths: string[] = []): Promise<FsDirectoryListing> {
  const target = resolve(pathInput);
  assertSafeDirectoryName(nameInput);
  assertNotProtected(target, protectedPaths);
  const parent = dirname(target);
  const nextPath = resolve(parent, nameInput.trim());
  assertInsideParent(parent, nextPath);
  assertNotProtected(nextPath, protectedPaths);
  await rename(target, nextPath);
  return listDirectory(parent);
}

export async function deleteDirectory(pathInput: string, protectedPaths: string[] = []): Promise<FsDirectoryListing> {
  const target = resolve(pathInput);
  assertNotProtected(target, protectedPaths);
  const parent = dirname(target);
  await rm(target, { recursive: true });
  return listDirectory(parent);
}

function assertSafeDirectoryName(nameInput: string): void {
  const name = nameInput.trim();
  if (!name) throw new Error("文件夹名称不能为空");
  if (name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
    throw new Error("文件夹名称无效");
  }
  if (platform === "win32" && /[<>:"|?*]/.test(name)) {
    throw new Error("文件夹名称包含 Windows 不允许的字符");
  }
}

function assertInsideParent(parent: string, target: string): void {
  if (dirname(target) !== parent) {
    throw new Error("目标路径无效");
  }
}

function assertNotProtected(targetInput: string, protectedPaths: string[]): void {
  const target = normalizePath(targetInput);
  const blocked = protectedPaths.some((item) => {
    const protectedPath = normalizePath(item);
    return target === protectedPath || protectedPath.startsWith(`${target}${platform === "win32" ? "\\" : "/"}`);
  });
  if (blocked) {
    throw new Error("该文件夹正在使用中，不能更改");
  }
}

function normalizePath(pathInput: string): string {
  const resolved = resolve(pathInput);
  return platform === "win32" ? resolved.toLowerCase() : resolved;
}
