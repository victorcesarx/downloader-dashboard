import { scrapeGoFile } from './gofile.js';
import { scrapePixelDrain } from './pixeldrain.js';
import { scrapeCyberDrop } from './cyberdrop.js';
import { scrapeBunkr } from './bunkr.js';
import { scrapeGeneric } from './generic.js';
import { scrapeErome } from './erome.js';
import { scrapeTwitter } from './twitter.js';
import { scrapeImagePond } from './imagepond.js';

export async function analyzePage(url) {
  if (url.includes('imagepond.net')) {
    const imagePondData = await scrapeImagePond(url);
    if (imagePondData && imagePondData.items.length > 0) return imagePondData;
  }

  if (url.includes('gofile.io')) {
    const gfData = await scrapeGoFile(url);
    if (gfData && gfData.items.length > 0) return gfData;
  }

  if (url.includes('pixeldrain.com')) {
    const pdData = await scrapePixelDrain(url);
    if (pdData && pdData.items.length > 0) return pdData;
  }

  if (url.includes('cyberdrop.')) {
    const cdData = await scrapeCyberDrop(url);
    if (cdData && cdData.items.length > 0) return cdData;
  }

  if (url.includes('bunkr.')) {
    const bkData = await scrapeBunkr(url);
    if (bkData && bkData.items.length > 0) return bkData;
  }

  if (url.includes('erome.com')) {
    const erData = await scrapeErome(url);
    if (erData && erData.items.length > 0) return erData;
  }

  if (url.includes('x.com') || url.includes('twitter.com')) {
    return await scrapeTwitter(url);
  }

  return await scrapeGeneric(url);
}

export function identifyScraper(url) {
  if (url.includes('imagepond.net')) return 'imagepond';
  if (url.includes('gofile.io')) return 'gofile';
  if (url.includes('pixeldrain.com')) return 'pixeldrain';
  if (url.includes('cyberdrop.')) return 'cyberdrop';
  if (url.includes('bunkr.')) return 'bunkr';
  if (url.includes('erome.com')) return 'erome';
  if (url.includes('x.com') || url.includes('twitter.com')) return 'twitter';
  return 'generic';
}
