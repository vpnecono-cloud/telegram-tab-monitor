const TELEGRAM_API = "https://api.telegram.org/bot";

const ALARM_PREFIX = "service_";


// --------------------------------------------------
// Utility
// --------------------------------------------------

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


function randomMinutes(min, max) {

  min = Number(min);
  max = Number(max);

  if (max < min) {
    [min, max] = [max, min];
  }

  return min + Math.random() * (max - min);
}


function alarmName(serviceId) {
  return `${ALARM_PREFIX}${serviceId}`;
}


// --------------------------------------------------
// Storage
// --------------------------------------------------

async function getData() {

  return await chrome.storage.local.get({
    botToken: "",
    chatId: "",
    services: {}
  });
}


async function saveServices(services) {

  await chrome.storage.local.set({
    services
  });
}


// --------------------------------------------------
// Schedule
// --------------------------------------------------

async function scheduleService(service) {

  if (!service || !service.enabled) {
    return;
  }

  const minutes = randomMinutes(
    service.minMinutes,
    service.maxMinutes
  );

  const when =
    Date.now() + minutes * 60 * 1000;


  await chrome.alarms.create(
    alarmName(service.id),
    {
      when
    }
  );


  console.log(
    `Service "${service.name}" scheduled in ${minutes.toFixed(1)} minutes`
  );
}


// --------------------------------------------------
// Find target tab
// --------------------------------------------------

async function getTargetTab(service) {

  if (service.tabId) {

    try {

      const tab =
        await chrome.tabs.get(
          service.tabId
        );

      if (tab) {
        return tab;
      }

    } catch (error) {
      // Tab closed.
    }
  }


  // Try URL
  if (service.url) {

    const tabs =
      await chrome.tabs.query({});


    const matchingTab =
      tabs.find(tab =>
        tab.url === service.url
      );


    if (matchingTab) {
      return matchingTab;
    }
  }


  return null;
}


// --------------------------------------------------
// Wait for page loading
// --------------------------------------------------

function waitForTabComplete(
  tabId,
  timeout = 60000
) {

  return new Promise(resolve => {

    let finished = false;


    const finish = () => {

      if (finished) {
        return;
      }

      finished = true;

      chrome.tabs.onUpdated.removeListener(
        listener
      );

      resolve();
    };


    const listener =
      (updatedTabId, changeInfo) => {

        if (
          updatedTabId === tabId &&
          changeInfo.status === "complete"
        ) {
          finish();
        }
      };


    chrome.tabs.onUpdated.addListener(
      listener
    );


    setTimeout(
      finish,
      timeout
    );
  });
}


// --------------------------------------------------
// Wait until page is ready
// --------------------------------------------------

async function waitForPageReady(tabId) {

  for (let i = 0; i < 20; i++) {

    try {

      const result =
        await chrome.scripting.executeScript({

          target: {
            tabId
          },

          func: () => {

            return {
              ready:
                document.readyState === "complete",

              width:
                document.documentElement?.scrollWidth || 0,

              height:
                document.documentElement?.scrollHeight || 0
            };
          }
        });


      if (
        result &&
        result[0] &&
        result[0].result &&
        result[0].result.ready
      ) {

        return true;
      }

    } catch (error) {
      // Page may still be initializing.
    }


    await sleep(1000);
  }


  return false;
}


// --------------------------------------------------
// Capture page using html2canvas
// --------------------------------------------------

async function capturePage(tabId) {

  try {

    const result =
      await chrome.scripting.executeScript({

        target: {
          tabId
        },

        files: [
          "html2canvas.min.js",
          "screenshot.js"
        ]
      });


    if (
      !result ||
      !result[0] ||
      !result[0].result
    ) {

      throw new Error(
        "Screenshot script returned no result."
      );
    }


    const screenshot =
      result[0].result;


    if (!screenshot.success) {

      throw new Error(
        screenshot.error ||
        "Screenshot failed."
      );
    }


    return screenshot.dataUrl;

  } catch (error) {

    throw new Error(
      `Failed to capture page: ${error.message}`
    );
  }
}


// --------------------------------------------------
// Telegram
// --------------------------------------------------

async function sendScreenshotToTelegram(
  botToken,
  chatId,
  imageDataUrl,
  caption
) {

  const blob =
    await fetch(
      imageDataUrl
    ).then(response =>
      response.blob()
    );


  const formData =
    new FormData();


  formData.append(
    "chat_id",
    chatId
  );


  formData.append(
    "caption",
    caption
  );


  formData.append(
    "photo",
    blob,
    "screenshot.png"
  );


  const response =
    await fetch(
      `${TELEGRAM_API}${botToken}/sendPhoto`,
      {
        method: "POST",
        body: formData
      }
    );


  const result =
    await response.json();


  if (!result.ok) {

    throw new Error(
      result.description ||
      "Telegram API error"
    );
  }


  return result;
}


// --------------------------------------------------
// Run service
// --------------------------------------------------

async function runService(serviceId) {

  const data =
    await getData();


  const service =
    data.services[serviceId];


  if (!service) {

    console.log(
      "Service not found:",
      serviceId
    );

    return;
  }


  if (!service.enabled) {

    console.log(
      `Service "${service.name}" is disabled.`
    );

    return;
  }


  if (
    !data.botToken ||
    !data.chatId
  ) {

    console.error(
      "Telegram Bot Token or Chat ID is missing."
    );

    await scheduleService(service);

    return;
  }


  try {

    let tab =
      await getTargetTab(service);


    if (!tab) {

      throw new Error(
        `Target tab for "${service.name}" was not found.`
      );
    }


    // Save latest tab information.
    service.tabId =
      tab.id;

    service.windowId =
      tab.windowId;


    await saveServices(
      data.services
    );


    console.log(
      `Running service "${service.name}" on tab ${tab.id}`
    );


    // Activate tab.
    await chrome.tabs.update(
      tab.id,
      {
        active: true
      }
    );


    await sleep(1000);


    // Refresh.
    console.log(
      `Refreshing "${service.name}"...`
    );


    await chrome.tabs.reload(
      tab.id
    );


    // Wait for reload.
    await waitForTabComplete(
      tab.id,
      60000
    );


    // Wait until DOM is ready.
    await waitForPageReady(
      tab.id
    );


    // Extra rendering time.
    await sleep(5000);


    console.log(
      `Capturing "${service.name}"...`
    );


    // Retry screenshot up to 3 times.
    let screenshot = null;

    let lastError = null;


    for (let attempt = 1; attempt <= 3; attempt++) {

      try {

        screenshot =
          await capturePage(
            tab.id
          );

        break;

      } catch (error) {

        lastError = error;

        console.warn(
          `Screenshot attempt ${attempt} failed:`,
          error.message
        );

        await sleep(3000);
      }
    }


    if (!screenshot) {

      throw new Error(
        lastError?.message ||
        "Screenshot failed after 3 attempts."
      );
    }


    console.log(
      `Sending "${service.name}" to Telegram...`
    );


    const caption =
      `📸 ${service.name}`;


    await sendScreenshotToTelegram(
      data.botToken,
      data.chatId,
      screenshot,
      caption
    );


    console.log(
      `Screenshot successfully sent for "${service.name}".`
    );


  } catch (error) {

    console.error(
      `Error running "${service.name}":`,
      error
    );
  }


  // Always schedule next run.
  await scheduleService(
    service
  );
}


// --------------------------------------------------
// Alarm
// --------------------------------------------------

chrome.alarms.onAlarm.addListener(
  async alarm => {

    if (
      !alarm.name.startsWith(
        ALARM_PREFIX
      )
    ) {
      return;
    }


    const serviceId =
      alarm.name.substring(
        ALARM_PREFIX.length
      );


    await runService(
      serviceId
    );
  }
);


// --------------------------------------------------
// Messages
// --------------------------------------------------

chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {

    handleMessage(message)
      .then(sendResponse)
      .catch(error => {

        console.error(error);

        sendResponse({
          success: false,
          error: error.message
        });
      });


    return true;
  }
);


async function handleMessage(message) {

  const data =
    await getData();


  // ----------------------------------------------
  // Telegram settings
  // ----------------------------------------------

  if (
    message.type ===
    "saveTelegram"
  ) {

    await chrome.storage.local.set({

      botToken:
        message.botToken.trim(),

      chatId:
        message.chatId.trim()
    });


    return {
      success: true
    };
  }


  // ----------------------------------------------
  // Create service
  // ----------------------------------------------

  if (
    message.type ===
    "createService"
  ) {

    const id =
      crypto.randomUUID();


    data.services[id] = {

      id,

      name:
        message.name.trim(),

      tabId: null,

      windowId: null,

      url: "",

      title: "",

      minMinutes:
        Number(
          message.minMinutes
        ),

      maxMinutes:
        Number(
          message.maxMinutes
        ),

      enabled: false
    };


    await saveServices(
      data.services
    );


    return {
      success: true,
      service:
        data.services[id]
    };
  }


  // ----------------------------------------------
  // Update service
  // ----------------------------------------------

  if (
    message.type ===
    "updateService"
  ) {

    const service =
      data.services[
        message.serviceId
      ];


    if (!service) {

      return {
        success: false,
        error: "Service not found."
      };
    }


    service.name =
      message.name.trim();


    service.minMinutes =
      Number(
        message.minMinutes
      );


    service.maxMinutes =
      Number(
        message.maxMinutes
      );


    await saveServices(
      data.services
    );


    await chrome.alarms.clear(
      alarmName(service.id)
    );


    if (service.enabled) {

      await scheduleService(
        service
      );
    }


    return {
      success: true,
      service
    };
  }


  // ----------------------------------------------
  // Delete
  // ----------------------------------------------

  if (
    message.type ===
    "deleteService"
  ) {

    const serviceId =
      message.serviceId;


    await chrome.alarms.clear(
      alarmName(serviceId)
    );


    delete data.services[
      serviceId
    ];


    await saveServices(
      data.services
    );


    return {
      success: true
    };
  }


  // ----------------------------------------------
  // Set current tab
  // ----------------------------------------------

  if (
    message.type ===
    "setCurrentTab"
  ) {

    const service =
      data.services[
        message.serviceId
      ];


    if (!service) {

      return {
        success: false,
        error: "Service not found."
      };
    }


    const tabs =
      await chrome.tabs.query({
        active: true,
        currentWindow: true
      });


    const tab =
      tabs[0];


    if (!tab) {

      return {
        success: false,
        error: "No active tab found."
      };
    }


    service.tabId =
      tab.id;


    service.windowId =
      tab.windowId;


    service.url =
      tab.url || "";


    service.title =
      tab.title || "";


    await saveServices(
      data.services
    );


    return {
      success: true,
      service
    };
  }


  // ----------------------------------------------
  // Enable
  // ----------------------------------------------

  if (
    message.type ===
    "enableService"
  ) {

    const service =
      data.services[
        message.serviceId
      ];


    if (!service) {

      return {
        success: false,
        error: "Service not found."
      };
    }


    if (
      !service.tabId &&
      !service.url
    ) {

      return {
        success: false,
        error:
          "First assign a target tab."
      };
    }


    service.enabled = true;


    await saveServices(
      data.services
    );


    await chrome.alarms.clear(
      alarmName(service.id)
    );


    await scheduleService(
      service
    );


    return {
      success: true,
      service
    };
  }


  // ----------------------------------------------
  // Disable
  // ----------------------------------------------

  if (
    message.type ===
    "disableService"
  ) {

    const service =
      data.services[
        message.serviceId
      ];


    if (!service) {

      return {
        success: false,
        error: "Service not found."
      };
    }


    service.enabled = false;


    await chrome.alarms.clear(
      alarmName(service.id)
    );


    await saveServices(
      data.services
    );


    return {
      success: true,
      service
    };
  }


  // ----------------------------------------------
  // Screenshot Now
  // ----------------------------------------------

  if (
    message.type ===
    "runNow"
  ) {

    await runService(
      message.serviceId
    );


    return {
      success: true
    };
  }


  // ----------------------------------------------
  // Get data
  // ----------------------------------------------

  if (
    message.type ===
    "getData"
  ) {

    return {

      success: true,

      botToken:
        data.botToken,

      chatId:
        data.chatId,

      services:
        data.services
    };
  }


  return {
    success: false,
    error: "Unknown message type."
  };
}


// --------------------------------------------------
// Chrome startup
// --------------------------------------------------

chrome.runtime.onStartup.addListener(
  async () => {

    const data =
      await getData();


    for (
      const serviceId in data.services
    ) {

      const service =
        data.services[
          serviceId
        ];


      if (service.enabled) {

        await chrome.alarms.clear(
          alarmName(
            service.id
          )
        );


        await scheduleService(
          service
        );
      }
    }
  }
);