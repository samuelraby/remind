#!/bin/sh
# Builds Remind and packages the installable folder as Remind.zip.
set -e
cd "$(dirname "$0")/.."
rm -rf build Remind Remind.zip
npx ray build -e dist -o build
mkdir Remind
cp -R build/remind.js build/assets Remind/
# Tinycast reads only the manifest fields; drop the build-only ones.
node -e '
const fs = require("fs");
const manifest = JSON.parse(fs.readFileSync("build/package.json", "utf8"));
for (const key of ["$schema", "dependencies", "devDependencies", "scripts"]) delete manifest[key];
fs.writeFileSync("Remind/package.json", JSON.stringify(manifest, null, 2) + "\n");
'
zip -qr Remind.zip Remind
echo "Created Remind.zip"
