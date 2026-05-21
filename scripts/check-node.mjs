const [major] = process.versions.node.split(".").map(Number);
if (major < 18) {
  console.error(
    `\n当前 Node.js 版本为 v${process.versions.node}，需要 v18 或更高（推荐 v20）。\n` +
      `请升级后重试，例如：\n` +
      `  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -\n` +
      `  sudo apt-get install -y nodejs\n` +
      `或从 https://nodejs.org 安装 LTS。\n`
  );
  process.exit(1);
}
