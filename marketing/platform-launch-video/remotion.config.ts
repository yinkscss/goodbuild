import { Config } from "@remotion/cli/config";

// Use the Chromium that ships in this environment; swangle gives three.js a software GL context.
Config.setChromiumOpenGlRenderer("swangle");
Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(95);
