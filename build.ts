import cheerio from "cheerio";
import klaw from "klaw";
import fs from "fs";
import path from "path/posix";
import url from "url";
import { crc32 } from "node-crc";
import { minify } from "html-minifier-terser";
import * as terser from "terser";

import { isRelativeUrl } from "./utils.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT_PATH = __dirname + "/OI-wiki";
const CDN_ROOT = "https://static.cdn.menci.xyz/oi-wiki/";
const PLAUSIBLE_DOMAIN = "oi.wiki"
const PLAUSIBLE_SCRIPT = "https://stat.u.sb/js/plausible.js";
const HOOK_FETCH_SCRIPT = (await terser.minify(fs.readFileSync(__dirname + "/hook-fetch.js", "utf-8").replace("__CDN_ROOT__", JSON.stringify(CDN_ROOT)))).code;

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

          const resolvedCdnUrl = originalUrl.startsWith("/")
                                 ? new URL(originalUrl.slice(1), CDN_ROOT)
                                 : new URL(originalUrl, htmlFileCdnUrl);
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

  $("a[title=编辑此页], a.md-header-nav__button, a.md-nav__button").each((_, element) => {
    const href = $(element).attr("href");
    $(element).attr("href", href.replace("https://oi-wiki.org/", "/"));
  });

  $("script[src=\"https://giscus.app/client.js\"]").each((_, element) => {
    $(element).attr("src", "https://giscus.api.menci.xyz/client.js");
    $(element).attr("data-theme", "menci");
    $(element).removeAttr("crossorigin");
  });

  const plausibleTag = $("<script>");
  plausibleTag.attr("async", "");
  plausibleTag.attr("data-domain", PLAUSIBLE_DOMAIN);
  plausibleTag.attr("src", PLAUSIBLE_SCRIPT);
  $("head").append(plausibleTag);

  const hookFetchScriptTag = $("<script>");
  hookFetchScriptTag.text(HOOK_FETCH_SCRIPT);
  $("head").append(hookFetchScriptTag);

  await fs.promises.writeFile(htmlFilePath, await minify($.html(), {
    includeAutoGeneratedTags: true,
    removeAttributeQuotes: true,
    removeRedundantAttributes: true,
    removeScriptTypeAttributes: true,
    removeStyleLinkTypeAttributes: true,
    sortClassName: true,
    useShortDoctype: true,
    minifyJS: true,
    minifyCSS: true
  }));
  console.log(`Processed: ${htmlFilePath}`);
};
