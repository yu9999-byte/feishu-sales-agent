const fs = require("fs");

const inputPath = process.argv[2];
const outputPath = process.argv[3];
const groupTitles = new Set([
  "销售执行循环",
  "个人工作循环",
  "团队管理与学习循环",
]);

const document = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const shapes = [];
const connectors = [];
const backgrounds = [];

for (const node of document.nodes) {
  if (groupTitles.has(node.text?.text)) {
    backgrounds.push(node);
  } else if (node.type === "connector") {
    connectors.push(node);
  } else {
    shapes.push(node);
  }
}

document.nodes = [...shapes, ...connectors, ...backgrounds];
fs.writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`);

console.log(JSON.stringify({
  shapes: shapes.length,
  connectors: connectors.length,
  backgrounds: backgrounds.length,
}));
