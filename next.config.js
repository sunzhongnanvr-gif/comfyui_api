module.exports = {
  reactStrictMode: true,
  async rewrites() {
    return []
  },
  env: {
    COMFYUI_SERVER: process.env.COMFYUI_SERVER || 'http://162.105.14.34:8188'
  }
}
