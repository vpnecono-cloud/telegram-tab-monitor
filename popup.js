document.addEventListener(
    "DOMContentLoaded",
    loadData
  );
  
  
  const $ = id =>
    document.getElementById(id);
  
  
  function showMessage(message) {
  
    $("message").textContent =
      message;
  
    setTimeout(() => {
  
      $("message").textContent = "";
  
    }, 3000);
  }
  
  
  // --------------------------------------------------
  // Load data
  // --------------------------------------------------
  
  async function loadData() {
  
    const response =
      await chrome.runtime.sendMessage({
        type: "getData"
      });
  
  
    if (!response.success) {
      showMessage(response.error);
      return;
    }
  
  
    $("botToken").value =
      response.botToken || "";
  
    $("chatId").value =
      response.chatId || "";
  
  
    renderServices(
      response.services
    );
  }
  
  
  // --------------------------------------------------
  // Save Telegram
  // --------------------------------------------------
  
  $("saveTelegram").addEventListener(
    "click",
    async () => {
  
      const botToken =
        $("botToken").value.trim();
  
      const chatId =
        $("chatId").value.trim();
  
  
      if (!botToken || !chatId) {
  
        showMessage(
          "Please enter Bot Token and Chat ID."
        );
  
        return;
      }
  
  
      const response =
        await chrome.runtime.sendMessage({
          type: "saveTelegram",
          botToken: botToken,
          chatId: chatId
        });
  
  
      if (response.success) {
  
        showMessage(
          "Telegram settings saved."
        );
  
      } else {
  
        showMessage(
          response.error
        );
      }
    }
  );
  
  
  // --------------------------------------------------
  // Add service
  // --------------------------------------------------
  
  $("addService").addEventListener(
    "click",
    async () => {
  
      const name =
        $("newName").value.trim();
  
      const minMinutes =
        Number($("newMin").value);
  
      const maxMinutes =
        Number($("newMax").value);
  
  
      if (!name) {
  
        showMessage(
          "Enter a service name."
        );
  
        return;
      }
  
  
      if (
        !Number.isFinite(minMinutes) ||
        !Number.isFinite(maxMinutes) ||
        minMinutes <= 0 ||
        maxMinutes <= 0
      ) {
  
        showMessage(
          "Enter valid time values."
        );
  
        return;
      }
  
  
      if (maxMinutes < minMinutes) {
  
        showMessage(
          "Maximum must be greater than or equal to minimum."
        );
  
        return;
      }
  
  
      const response =
        await chrome.runtime.sendMessage({
  
          type: "createService",
  
          name: name,
  
          minMinutes:
            minMinutes,
  
          maxMinutes:
            maxMinutes
        });
  
  
      if (!response.success) {
  
        showMessage(
          response.error
        );
  
        return;
      }
  
  
      $("newName").value = "";
  
  
      await loadData();
  
  
      showMessage(
        "Service created."
      );
    }
  );
  
  
  // --------------------------------------------------
  // Render services
  // --------------------------------------------------
  
  function renderServices(
    services
  ) {
  
    const container =
      $("services");
  
  
    container.innerHTML = "";
  
  
    const list =
      Object.values(services);
  
  
    if (list.length === 0) {
  
      container.innerHTML =
        "<p>No services yet.</p>";
  
      return;
    }
  
  
    list.forEach(service => {
  
      const element =
        document.createElement(
          "div"
        );
  
  
      element.className =
        "service";
  
  
      const status =
        service.enabled
          ? "🟢 Active"
          : "⚪ Disabled";
  
  
      const tabInfo =
        service.url
          ? service.url
          : "No target tab selected";
  
  
      element.innerHTML = `
  
        <div class="service-header">
  
          <div class="service-name">
            ${escapeHtml(service.name)}
          </div>
  
          <div class="status">
            ${status}
          </div>
  
        </div>
  
  
        <div class="row">
  
          <div>
  
            <label>Min (min)</label>
  
            <input
              type="number"
              class="min-input"
              value="${service.minMinutes}"
              min="1"
            >
  
          </div>
  
  
          <div>
  
            <label>Max (min)</label>
  
            <input
              type="number"
              class="max-input"
              value="${service.maxMinutes}"
              min="1"
            >
  
          </div>
  
        </div>
  
  
        <div class="tab-info">
          ${escapeHtml(tabInfo)}
        </div>
  
  
        <button
          class="primary set-tab"
        >
          Set Current Tab
        </button>
  
  
        <button
          class="secondary save-service"
        >
          Save
        </button>
  
  
        <button
          class="secondary run-now"
        >
          📸 Screenshot Now
        </button>
  
  
        ${
          service.enabled
  
          ? `
  
            <button
              class="danger disable-service"
            >
              Disable
            </button>
  
          `
  
          : `
  
            <button
              class="success enable-service"
            >
              Enable
            </button>
  
          `
        }
  
  
        <button
          class="danger delete-service"
        >
          Delete
        </button>
  
      `;
  
  
      container.appendChild(
        element
      );
  
  
      // ----------------------------------------------
      // Set current tab
      // ----------------------------------------------
  
      element
        .querySelector(".set-tab")
        .addEventListener(
          "click",
          async () => {
  
            const response =
              await chrome.runtime.sendMessage({
  
                type: "setCurrentTab",
  
                serviceId:
                  service.id
              });
  
  
            if (response.success) {
  
              showMessage(
                `"${service.name}" target tab saved.`
              );
  
              await loadData();
  
            } else {
  
              showMessage(
                response.error
              );
            }
          }
        );
  
  
      // ----------------------------------------------
      // Save
      // ----------------------------------------------
  
      element
        .querySelector(".save-service")
        .addEventListener(
          "click",
          async () => {
  
            const minMinutes =
              Number(
                element.querySelector(
                  ".min-input"
                ).value
              );
  
  
            const maxMinutes =
              Number(
                element.querySelector(
                  ".max-input"
                ).value
              );
  
  
            if (
              minMinutes <= 0 ||
              maxMinutes <= 0 ||
              maxMinutes < minMinutes
            ) {
  
              showMessage(
                "Invalid time range."
              );
  
              return;
            }
  
  
            const response =
              await chrome.runtime.sendMessage({
  
                type: "updateService",
  
                serviceId:
                  service.id,
  
                name:
                  service.name,
  
                minMinutes:
                  minMinutes,
  
                maxMinutes:
                  maxMinutes
              });
  
  
            if (response.success) {
  
              showMessage(
                "Service saved."
              );
  
              await loadData();
  
            } else {
  
              showMessage(
                response.error
              );
            }
          }
        );
  
  
      // ----------------------------------------------
      // Enable
      // ----------------------------------------------
  
      const enableButton =
        element.querySelector(
          ".enable-service"
        );
  
  
      if (enableButton) {
  
        enableButton.addEventListener(
          "click",
          async () => {
  
            const response =
              await chrome.runtime.sendMessage({
  
                type: "enableService",
  
                serviceId:
                  service.id
              });
  
  
            if (response.success) {
  
              showMessage(
                `"${service.name}" enabled.`
              );
  
              await loadData();
  
            } else {
  
              showMessage(
                response.error
              );
            }
          }
        );
      }
  
  
      // ----------------------------------------------
      // Disable
      // ----------------------------------------------
  
      const disableButton =
        element.querySelector(
          ".disable-service"
        );
  
  
      if (disableButton) {
  
        disableButton.addEventListener(
          "click",
          async () => {
  
            const response =
              await chrome.runtime.sendMessage({
  
                type: "disableService",
  
                serviceId:
                  service.id
              });
  
  
            if (response.success) {
  
              showMessage(
                `"${service.name}" disabled.`
              );
  
              await loadData();
  
            } else {
  
              showMessage(
                response.error
              );
            }
          }
        );
      }
  
  
      // ----------------------------------------------
      // Screenshot Now
      // ----------------------------------------------
  
      element
        .querySelector(".run-now")
        .addEventListener(
          "click",
          async () => {
  
            showMessage(
              `Running "${service.name}"...`
            );
  
  
            const response =
              await chrome.runtime.sendMessage({
  
                type: "runNow",
  
                serviceId:
                  service.id
              });
  
  
            if (response.success) {
  
              showMessage(
                `"${service.name}" screenshot completed.`
              );
  
            } else {
  
              showMessage(
                response.error
              );
            }
          }
        );
  
  
      // ----------------------------------------------
      // Delete
      // ----------------------------------------------
  
      element
        .querySelector(".delete-service")
        .addEventListener(
          "click",
          async () => {
  
            const confirmed =
              confirm(
                `Delete "${service.name}"?`
              );
  
  
            if (!confirmed) {
              return;
            }
  
  
            const response =
              await chrome.runtime.sendMessage({
  
                type: "deleteService",
  
                serviceId:
                  service.id
              });
  
  
            if (response.success) {
  
              showMessage(
                "Service deleted."
              );
  
              await loadData();
  
            } else {
  
              showMessage(
                response.error
              );
            }
          }
        );
  
    });
  }
  
  
  // --------------------------------------------------
  // HTML escaping
  // --------------------------------------------------
  
  function escapeHtml(
    text
  ) {
  
    const div =
      document.createElement(
        "div"
      );
  
    div.textContent =
      text || "";
  
    return div.innerHTML;
  }