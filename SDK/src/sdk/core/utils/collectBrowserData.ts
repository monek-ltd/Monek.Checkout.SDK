export async function collectBrowserInformation(): Promise<{
    acceptHeader: string;
    ipAddress?: string;
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
    let ip: string | undefined;

    await fetch("https://api.ipify.org/?format=json")
                .then(response => response.json())
                .then(data => {
                    ip = data.ip;
                })
                .catch(error => {
                    console.error("Error fetching IP address:", error);
                });
    return {
      acceptHeader: '*/*',
      ipAddress: ip,
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