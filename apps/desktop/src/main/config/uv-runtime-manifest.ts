import type { ManagedRuntimeManifest, RuntimeManifestAsset } from "../../shared/types";

const ASTRAL_RELEASE_BASE = "https://releases.astral.sh/github/uv/releases/download/0.12.5";
const GITHUB_RELEASE_BASE = "https://github.com/astral-sh/uv/releases/download/0.12.5";

function asset(
  name: string,
  platform: RuntimeManifestAsset["platform"],
  architecture: RuntimeManifestAsset["architecture"],
  sha256: string,
  libc: RuntimeManifestAsset["libc"] = null,
  minimumGlibc: string | null = null,
): RuntimeManifestAsset {
  const archiveType = name.endsWith(".zip") ? "zip" : "tar.gz";
  const archiveLayout = archiveType === "zip" ? "flat" : "top-level-directory";
  const topLevel = name.replace(/\.(?:zip|tar\.gz)$/, "");
  const executablePrefix = archiveLayout === "flat" ? "" : `${topLevel}/`;
  const executableExtension = platform === "win32" ? ".exe" : "";
  return {
    runtime: "uv",
    version: "0.12.5",
    platform,
    architecture,
    libc,
    minimumGlibc,
    archiveUrl: `${ASTRAL_RELEASE_BASE}/${name}`,
    fallbackArchiveUrls: [`${GITHUB_RELEASE_BASE}/${name}`],
    archiveType,
    archiveLayout,
    sha256,
    executableRelativePath: `${executablePrefix}uv${executableExtension}`,
    providedCommands: ["uv", "uvx"],
    executables: [
      { command: "uv", relativePath: `${executablePrefix}uv${executableExtension}` },
      { command: "uvx", relativePath: `${executablePrefix}uvx${executableExtension}` },
    ],
  };
}

export const UV_RUNTIME_MANIFEST: ManagedRuntimeManifest = {
  schema: "ayaka-runtime-manifest-v2",
  runtime: "uv",
  channel: "stable",
  generatedAt: "2026-08-21T00:00:00.000Z",
  releases: [
    {
      version: "0.12.5",
      assets: [
        asset(
          "uv-x86_64-pc-windows-msvc.zip",
          "win32",
          "x64",
          "4c4d49d8738847d9b71ba319e49a5688c93eac0fe6204b1df24e98528dddf39a",
        ),
        asset(
          "uv-aarch64-pc-windows-msvc.zip",
          "win32",
          "arm64",
          "724279317fee6e5fa8ad1908e4eba2bbe764ef1ece5b3f4597927b62b1fe562a",
        ),
        asset(
          "uv-x86_64-apple-darwin.tar.gz",
          "darwin",
          "x64",
          "b3b2137477cf96c9686ebfb71524614cec780c673fd73e59bce099aef02e70e8",
        ),
        asset(
          "uv-aarch64-apple-darwin.tar.gz",
          "darwin",
          "arm64",
          "5bb0e5fe008a773c3dbcb97ff79cd89e1241464fe9d2f986d52ad8f1b037bd62",
        ),
        asset(
          "uv-x86_64-unknown-linux-gnu.tar.gz",
          "linux",
          "x64",
          "68a509da24b06b4223a1c0175fb5eb5bc79342b76cbeff0cfe51ac3f5b17b6b2",
          "gnu",
          "2.17",
        ),
        asset(
          "uv-aarch64-unknown-linux-gnu.tar.gz",
          "linux",
          "arm64",
          "9bf43b4d1a07665bf64d4c4e710930b382321a785e0eb10aac07f46471f86a31",
          "gnu",
          "2.28",
        ),
        asset(
          "uv-x86_64-unknown-linux-musl.tar.gz",
          "linux",
          "x64",
          "a4742988791c9aeae68c78150d6cba762062ad2a47e53738c2779d2b596bfcdb",
          "musl",
        ),
        asset(
          "uv-aarch64-unknown-linux-musl.tar.gz",
          "linux",
          "arm64",
          "8767a0e77f2cd45436401b1b42bf7e9ed5a4a91a74a5305d6fe93249d0f6dbc5",
          "musl",
        ),
      ],
    },
  ],
};
