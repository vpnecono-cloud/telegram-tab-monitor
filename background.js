const TELEGRAM_API = "https://api.telegram.org/bot";

const ALARM_PREFIX = "service_";

const TEHRAN_TIME_ZONE = "Asia/Tehran";


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
// Tehran Time
// --------------------------------------------------

function getTehranParts(timestamp = Date.now()) {

  const formatter =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone: TEHRAN_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
      }
    );


  const parts =
    formatter.formatToParts(
      new Date(timestamp)
    );


  const result = {};


  for (const part of parts) {

    if (part.type !== "literal") {

      result[part.type] =
        Number(part.value);
    }
  }


  return result;
}


function formatTehranTime(timestamp) {

  return new Intl.DateTimeFormat(
    "en-GB",
    {
      timeZone: TEHRAN_TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }
  ).format(
    new Date(timestamp)
  );
}


function formatSystemTime(timestamp) {

  return new Date(timestamp)
    .toLocaleTimeString(
      "en-GB",
      {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }
    );
}


// --------------------------------------------------
// Sleep Mode
// --------------------------------------------------

function parseTimeToMinutes(value) {

  if (
    !value ||
    !/^\d{2}:\d{2}$/.test(value)
  ) {
    return null;
  }


  const [hour, minute] =
    value
      .split(":")
      .map(Number);


  if (
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }


  return (
    hour * 60 +
    minute
  );
}


function isInSleepWindow(
  service,
  timestamp = Date.now()
) {

  if (!service.sleepEnabled) {
    return false;
  }


  const start =
    parseTimeToMinutes(
      service.sleepStart
    );


  const end =
    parseTimeToMinutes(
      service.sleepEnd
    );


  if (
    start === null ||
    end === null ||
    start === end
  ) {
    return false;
  }


  const tehran =
    getTehranParts(
      timestamp
    );


  const currentMinutes =
    tehran.hour * 60 +
    tehran.minute;


  // Example:
  // 01:00 -> 06:00
  if (start < end) {

    return (
      currentMinutes >= start &&
      currentMinutes < end
    );
  }


  // Overnight:
  // 23:00 -> 06:00
  return (
    currentMinutes >= start ||
    currentMinutes < end
  );
}


function getTehranOffsetMs(timestamp) {

  const tehran =
    getTehranParts(
      timestamp
    );


  const utcRepresentation =
    Date.UTC(
      tehran.year,
      tehran.month - 1,
      tehran.day,
      tehran.hour,
      tehran.minute,
      tehran.second
    );


  return (
    utcRepresentation -
    Math.floor(timestamp / 1000) * 1000
  );
}


function getSleepEndTimestamp(
  service,
  timestamp = Date.now()
) {

  const start =
    parseTimeToMinutes(
      service.sleepStart
    );


  const end =
    parseTimeToMinutes(
      service.sleepEnd
    );


  if (
    start === null ||
    end === null
  ) {
    return timestamp;
  }


  const tehran =
    getTehranParts(
      timestamp
    );


  const currentMinutes =
    tehran.hour * 60 +
    tehran.minute;


  let targetYear =
    tehran.year;


  let targetMonth =
    tehran.month;


  let targetDay =
    tehran.day;


  // If the sleep window crosses midnight
  // and we are already after the start,
  // the end time is tomorrow.
  if (
    start > end &&
    currentMinutes >= start
  ) {

    const temp =
      new Date(
        Date.UTC(
          targetYear,
          targetMonth - 1,
          targetDay
        )
      );


    temp.setUTCDate(
      temp.getUTCDate() + 1
    );


    targetYear =
      temp.getUTCFullYear();

    targetMonth =
      temp.getUTCMonth() + 1;

    targetDay =
      temp.getUTCDate();
  }


  // Start with an approximate UTC timestamp.
  let candidate =
    Date.UTC(
      targetYear,
      targetMonth - 1,
      targetDay,
      Math.floor(end / 60),
      end % 60,
      0,
      0
    );


  // Correct the candidate using the actual
  // Tehran timezone offset.
  const offset =
    getTehranOffsetMs(
      candidate
    );


  candidate -= offset;


  return candidate;
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

  if (
    !service ||
    !service.enabled
  ) {
    return null;
  }


  const randomDelay =
    randomMinutes(
      service.minMinutes,
      service.maxMinutes
    );


  let when =
    Date.now() +
    randomDelay * 60 * 1000;


  // If the random next run falls inside
  // the sleep window, move it to sleep end.
  if (
    isInSleepWindow(
      service,
      when
    )
  ) {

    when =
      getSleepEndTimestamp(
        service,
        when
      );
  }


  const actualMinutes =
    Math.max(
      0,
      (
        when -
        Date.now()
      ) / 60000
    );


  await chrome.alarms.create(
    alarmName(service.id),
    {
      when
    }
  );


  console.log(
    `Service "${service.name}" scheduled in ${actualMinutes.toFixed(1)} minutes`
  );


  // Return the EXACT schedule created.
  return {
    when,
    minutes: actualMinutes
  };
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
      tabs.find(
        tab =>
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
      (
        updatedTabId,
        changeInfo
      ) => {

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

  for (
    let i = 0;
    i < 20;
    i++
  ) {

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
    ).then(
      response =>
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


  // --------------------------------------------------
  // Sleep Mode Check
  // --------------------------------------------------

  if (
    isInSleepWindow(service)
  ) {

    console.log(
      `Service "${service.name}" is currently in sleep mode.`
    );


    await scheduleService(
      service
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


    await scheduleService(
      service
    );


    return;
  }


  try {

    let tab =
      await getTargetTab(
        service
      );


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


    // --------------------------------------------------
    // Check Sleep Again Before Refresh
    // --------------------------------------------------

    if (
      isInSleepWindow(service)
    ) {

      console.log(
        `Service "${service.name}" entered sleep mode before refresh.`
      );


      await scheduleService(
        service
      );


      return;
    }


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


    // --------------------------------------------------
    // Check Sleep Again Before Screenshot
    // --------------------------------------------------

    if (
      isInSleepWindow(service)
    ) {

      console.log(
        `Service "${service.name}" entered sleep mode before screenshot.`
      );


      await scheduleService(
        service
      );


      return;
    }


    console.log(
      `Capturing "${service.name}"...`
    );


    // Retry screenshot up to 3 times.
    let screenshot = null;

    let lastError = null;


    for (
      let attempt = 1;
      attempt <= 3;
      attempt++
    ) {

      try {

        screenshot =
          await capturePage(
            tab.id
          );


        break;

      } catch (error) {

        lastError =
          error;


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


    // --------------------------------------------------
    // Schedule the NEXT run
    // --------------------------------------------------

    const nextSchedule =
      await scheduleService(
        service
      );


    let caption =
      `📸 ${service.name}`;


    if (nextSchedule) {

      const systemNextTime =
        formatSystemTime(
          nextSchedule.when
        );


      const tehranNextTime =
        formatTehranTime(
          nextSchedule.when
        );


      const minutesLater =
        nextSchedule.minutes.toFixed(1);


      caption +=
        `\nNext Screen: ${systemNextTime} (${minutesLater} min later)`;


      caption +=
        `\nTehran Next Screen: ${tehranNextTime}`;
    }


    // Save service data.
    await saveServices(
      data.services
    );


    console.log(
      `Sending "${service.name}" to Telegram...`
    );


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


    // If the screenshot/send process failed,
    // schedule the next run here.
    await scheduleService(
      service
    );
  }
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
  (
    message,
    sender,
    sendResponse
  ) => {

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

      sleepEnabled: false,

      sleepStart: "23:00",

      sleepEnd: "06:00",

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


    service.sleepEnabled =
      Boolean(
        message.sleepEnabled
      );


    service.sleepStart =
      message.sleepStart ||
      "23:00";


    service.sleepEnd =
      message.sleepEnd ||
      "06:00";


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