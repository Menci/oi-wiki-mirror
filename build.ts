import cheerio from "cheerio";
import klaw from "klaw";
import fs from "fs/promises";
import path from "path";

import { isRelativeUrl } from "./utils";

const ROOT_PATH = __dirname + "/OI-wiki";
const CDN_ROOT = "https://cdn.menci.xyz/oi-wiki/";

klaw(ROOT_PATH).on("data", item => {
  if (item.stats.isFile() && item.path.toLowerCase().endsWith(".html"))
    process(item.path);
});

const process = async (htmlFilePath: string) => {
  const htmlFileRelativePath = path.relative(ROOT_PATH, htmlFilePath);
  const currentHtmlCdnUrl = new URL(htmlFileRelativePath, CDN_ROOT);
  
  const $ = cheerio.load(
    await fs.readFile(htmlFilePath, "utf-8")
  );

  const processTag = (selector: string, attributeName: string, filter?: (tag: cheerio.Cheerio) => boolean) => {
    $(selector).each((_, element) => {
      if (filter && !filter($(element))) return;

      const url = $(element).attr(attributeName);
      if (!url) return;

      if (isRelativeUrl(url)) {
        $(element).attr(attributeName, new URL(url, currentHtmlCdnUrl).toString());
      }
    });
  };

  processTag("script", "src");
  processTag("link[rel=stylesheet]", "href");
  processTag("img", "src");

  await fs.writeFile(htmlFilePath, $.html());
  console.log(`Processed: ${htmlFilePath}`);
};
