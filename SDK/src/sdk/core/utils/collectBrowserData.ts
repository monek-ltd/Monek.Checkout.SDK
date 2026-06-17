export async function collectBrowserInformation(): Promise<{
    acceptHeader: string;
    isJavascriptEnabled: boolean;
    isJavaEnabled: boolean;
    language: string;
    colourDepth: string;
    screenHeight: string;
    screenWidth: string;
    timezone: string;
    userAgent: string;
  }> {
    const tzHours = -new Date().getTimezoneOffset() / 60;
    
    return {
      acceptHeader: '*/*',
      isJavascriptEnabled: true,
      isJavaEnabled: typeof navigator.javaEnabled === 'function' ? navigator.javaEnabled() : false,
      language: navigator.language || 'en',
      colourDepth: String(window.screen?.colorDepth ?? 32),
      screenHeight: String(window.screen?.height ?? 0),
      screenWidth: String(window.screen?.width ?? 0),
      timezone: String(tzHours),
      userAgent: navigator.userAgent || 'SDK',
    };
};
