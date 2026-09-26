(async () => {
  try {
    if (typeof html2canvas !== "function") {
      throw new Error("html2canvas is not loaded.");
    }

    const body = document.body;

    if (!body) {
      throw new Error("Document body not found.");
    }

    // Capture the rendered page.
    const canvas = await html2canvas(body, {
      useCORS: true,
      allowTaint: false,
      backgroundColor: "#ffffff",
      logging: false,
      scale: Math.min(window.devicePixelRatio || 1, 2),

      // Keep the screenshot at a reasonable size.
      windowWidth: document.documentElement.clientWidth,
      windowHeight: document.documentElement.clientHeight
    });

    // Convert canvas to PNG.
    const dataUrl = canvas.toDataURL("image/png");

    return {
      success: true,
      dataUrl: dataUrl
    };

  } catch (error) {

    return {
      success: false,
      error: error?.message || String(error)
    };
  }
})();