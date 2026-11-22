module.exports = function cloudflareImageProcessorUnavailable() {
  throw new Error('Image compositing is unavailable in the Cloudflare runtime.');
};
