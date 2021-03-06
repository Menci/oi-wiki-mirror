import cheerio from "cheerio";
import klaw from "klaw";
import fs from "fs";
import path from "path/posix";
import url from "url";
import { crc32 } from "node-crc";

import { isRelativeUrl } from "./utils";

const ROOT_PATH = __dirname + "/OI-wiki";
const CDN_ROOT = "https://cdn-static.menci.xyz/oi-wiki/";

klaw(ROOT_PATH).on("data", item => {
  if (item.stats.isFile() && item.path.toLowerCase().endsWith(".html"))
    process(item.path);
});

const hashCache = new Map<string, string>();
const hash = async (filePath: string) => {
  if (hashCache.has(filePath)) return hashCache.get(filePath);
  const hashValue = crc32(await fs.promises.readFile(filePath)).toString("base64url");
  hashCache.set(filePath, hashValue);
  return hashValue;
};

const process = async (htmlFilePath: string) => {
  const htmlFileRelativePath = path.relative(ROOT_PATH, htmlFilePath);
  // The file:// URL with ROOT_PATH as root
  const htmlFileFileUrl = url.pathToFileURL("/" + htmlFileRelativePath);
  const htmlFileCdnUrl = new URL(htmlFileRelativePath, CDN_ROOT);
  
  const $ = cheerio.load(
    await fs.promises.readFile(htmlFilePath, "utf-8")
  );

  const processTag = (selector: string, attributeName: string, filter?: (tag: cheerio.Cheerio) => boolean) =>
    Promise.all(
      $(selector).toArray().map(async element => {
        if (filter && !filter($(element))) return;

        const originalUrl = $(element).attr(attributeName);
        if (!originalUrl) return;

        if (isRelativeUrl(originalUrl)) {
          // Resolve referenced asset file's path
          const resolvedFileUrl = new URL(originalUrl, htmlFileFileUrl)
          const resolvedVirtualPath = url.fileURLToPath(resolvedFileUrl);
          const resolvedPath = path.join(ROOT_PATH, resolvedVirtualPath);
          if (!fs.existsSync(resolvedPath)) {
            console.warn(`404 Not Found: ${resolvedVirtualPath}, referenced in ${htmlFileRelativePath}, attr value ${originalUrl}`);
            return;
          }
          const fileHash = await hash(resolvedPath);

          const resolvedCdnUrl = new URL(originalUrl.startsWith("/") ? originalUrl.slice(1) : originalUrl, htmlFileCdnUrl);
          resolvedCdnUrl.search = "";
          resolvedCdnUrl.searchParams.set("h", fileHash);
          $(element).attr(attributeName, resolvedCdnUrl.toString());
        }
      })
    )

  await Promise.all([
    processTag("script", "src"),
    processTag("link[rel=stylesheet]", "href"),
    processTag("img", "src")
  ]);

  $("a[title=????????????], a.md-header-nav__button, a.md-nav__button").each((_, element) => {
    const href = $(element).attr("href");
    $(element).attr("href", href.replace("https://oi-wiki.org/", "/"));
  });

  await fs.promises.writeFile(htmlFilePath, $.html());
  console.log(`Processed: ${htmlFilePath}`);
};
