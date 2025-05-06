document.addEventListener("DOMContentLoaded", () => {
  const statusText = document.getElementById("statusText")
  const statusBadge = document.getElementById("statusBadge")
  const lastUpdated = document.getElementById("lastUpdated")
  const multiplierList = document.getElementById("multiplierList")
  const downloadData = document.getElementById("downloadData")
  const downloadCSV = document.getElementById("downloadCSV")
  const clearData = document.getElementById("clearData")
  const refreshButton = document.getElementById("refreshPage")
  const reloadScriptButton = document.getElementById("reloadScript")
  const modalBackdrop = document.getElementById("modal-backdrop")

  // Bet strategy elements
  const basicAmount = document.getElementById("basicAmount")
  const autoCashoutAt = document.getElementById("autoCashoutAt")
  const maxLimit = document.getElementById("maxLimit")
  const minLimit = document.getElementById("minLimit")
  const startTimer = document.getElementById("startTimer")
  const currentBalance = document.getElementById("currentBalance")

  // Martingale strategy variables
  let currentBetAmount = 0
  let lastBetSuccess = true
  const lastBetMultiplier = null
  let consecutiveFailures = 0 // Track consecutive failures
  const waitingForGameEnd = false // Track if we're waiting for current game to end

  // New buttons
  const halfBasic = document.getElementById("halfBasic")
  const doubleBasic = document.getElementById("doubleBasic")
  const decreaseAutoCashout = document.getElementById("decreaseAutoCashout")
  const increaseAutoCashout = document.getElementById("increaseAutoCashout")
  const decreaseMaxLimit = document.getElementById("decreaseMaxLimit")
  const increaseMaxLimit = document.getElementById("increaseMaxLimit")
  const decreaseMinLimit = document.getElementById("decreaseMinLimit")
  const increaseMinLimit = document.getElementById("increaseMinLimit")

  // Statistics elements
  const totalCount = document.getElementById("totalCount")
  const lowCount = document.getElementById("lowCount")
  const mediumCount = document.getElementById("mediumCount")
  const highCount = document.getElementById("highCount")
  const lowPercent = document.getElementById("lowPercent")
  const mediumPercent = document.getElementById("mediumPercent")
  const highPercent = document.getElementById("highPercent")

  // Modal elements
  let detailModal = null

  let isRunning = false
  let lastUpdateTime = null
  let limboHistory = []

  let currentPage = 1
  const itemsPerPage = 35 // 5 rows of 7 items
  let totalPages = 1

  // Store the bet strategy values
  let storedBasicAmount = localStorage.getItem("basicAmount") || "1.00"
  let storedAutoCashoutAt = localStorage.getItem("autoCashoutAt") || "2.00"
  let storedMaxLimit = localStorage.getItem("maxLimit") || "0"
  let storedMinLimit = localStorage.getItem("minLimit") || "0"

  // Automatic betting variables
  const autoBetTimer = null
  let balanceCheckTimer = null
  let isAutoBetting = false
  const lastBetTime = 0
  let userBalance = 0.0
  let balanceLoaded = false

  // Set initial values from storage
  basicAmount.value = storedBasicAmount
  autoCashoutAt.value = storedAutoCashoutAt
  maxLimit.value = storedMaxLimit
  minLimit.value = storedMinLimit

  // Function to update pagination
  function updatePagination(totalItems) {
    totalPages = Math.ceil(totalItems / itemsPerPage)
    pageInfo.textContent = `Page ${currentPage} of ${totalPages}`
    prevPage.disabled = currentPage <= 1
    nextPage.disabled = currentPage >= totalPages
  }

  // Check current status
  function checkStatus() {
    try {
      chrome.runtime.sendMessage({ action: "getStatus" }, (response) => {
        if (chrome.runtime.lastError) {
          console.error("Error getting status:", chrome.runtime.lastError)
          return
        }
        isRunning = response?.isRunning || false
        updateStatusUI()
      })
    } catch (error) {
      console.error("Error communicating with background script:", error)
    }
  }
  function loadHistory() {
    try {
      chrome.runtime.sendMessage({ action: "getHistory" }, (response) => {
        if (chrome.runtime.lastError) {
          console.error("Error getting history:", chrome.runtime.lastError)
          return
        }

        if (response?.history?.length > 0) {
          // Store the history for status updates
          const oldHistory = limboHistory
          limboHistory = response.history

          // Update statistics
          updateStatistics(limboHistory)

          // Render limbo values with pagination
          renderLimboValues()
        } else {
          limboHistory = []
          // Update statistics to zero
          updateStatistics(limboHistory)

          // Clear the multiplier list
          multiplierList.innerHTML = ""

          // Create a div for the "No limbo data collected yet" message
          const noDataDiv = document.createElement("div")
          noDataDiv.className = "no-data-message"
          noDataDiv.textContent = "No limbo data collected yet."
          multiplierList.appendChild(noDataDiv)

          // Update pagination
          updatePagination(0)

          updateStatusUI()
        }
      })
    } catch (error) {
      console.error("Error communicating with background script:", error)
    }
  }
  function updateLastUpdatedText() {
    if (lastUpdateTime) {
      lastUpdated.textContent = `Last updated: ${lastUpdateTime.toLocaleTimeString()}`
    }
  }
  function getBalance() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].url?.includes("bc.game/game/limbo")) {
        chrome.runtime.sendMessage(
          {
            action: "getBalance",
          },
          (response) => {
            if (response?.success && response.balance !== null) {
              userBalance = response.balance
              currentBalance.textContent = userBalance.toFixed(2)
              balanceLoaded = true
              currentBalance.classList.remove("balance-loading")
              currentBalance.classList.add("balance-loaded")
            } else if (response?.success && response.balance === null) {
              // Balance element not found
              currentBalance.textContent = "No balance"
              currentBalance.classList.remove("balance-loading")
              currentBalance.classList.add("balance-error")
            } else {
              // Error getting balance
              if (!balanceLoaded) {
                currentBalance.textContent = "Loading..."
                currentBalance.classList.add("balance-loading")
                currentBalance.classList.remove("balance-loaded", "balance-error")
              }
            }
          },
        )
      } else {
        currentBalance.textContent = "Not on BC Game limbo page"
        currentBalance.classList.remove("balance-loading", "balance-loaded")
        currentBalance.classList.add("balance-error")
      }
    })
  }

  // Check current status
  checkStatus()

  // Load history
  loadHistory()

  // Check if auto-betting is already running
  chrome.runtime.sendMessage({ action: "getAutoBettingStatus" }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("Error getting auto-betting status:", chrome.runtime.lastError)
      return
    }

    if (response && response.isAutoBetting) {
      isAutoBetting = true
      currentBetAmount = response.currentBetAmount
      consecutiveFailures = response.consecutiveFailures
      lastBetSuccess = response.lastBetSuccess
      lastGameEndTime = response.lastGameEndTime || 0

      // Update UI
      startTimer.textContent = "Stop Timer"
      startTimer.classList.add("bet-timer-active")
      startTimer.classList.remove("start-timer")
      startTimer.classList.add("stop-timer")

      // Start status check
      startAutoBettingStatusCheck()
    }
  })

  // Start balance check timer
  startBalanceCheckTimer()

  // Listen for new data updates
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "newDataAvailable") {
      lastUpdateTime = new Date()
      updateLastUpdatedText()
      loadHistory()
    } else if (request.action === "limitReached") {
      // Handle limit reached notification
      isAutoBetting = false
      startTimer.textContent = "Start Timer"
      startTimer.classList.remove("bet-timer-active")
      startTimer.classList.remove("stop-timer")
      startTimer.classList.add("start-timer")

      if (request.isMaxLimit) {
        statusText.textContent = `Status: Max limit reached (${request.balance.toFixed(2)} >= ${request.limit})`
        alert("Current balance is above maximum limit!")
      } else {
        statusText.textContent = `Status: Min limit reached (${request.balance.toFixed(2)} < ${request.limit})`
        alert("Current balance is below minimum limit!")
      }

      // Stop checking auto-betting status
      stopAutoBettingStatusCheck()
    }
  })

  // Refresh page button
  refreshButton.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.reload(tabs[0].id)
        statusText.textContent = "Status: Refreshing page..."
      }
    })
  })

  // Reload content script button
  reloadScriptButton.addEventListener("click", () => {
    statusText.textContent = "Status: Reloading content script..."
    reloadScriptButton.disabled = true

    chrome.runtime.sendMessage({ action: "reloadContentScript" }, (response) => {
      if (response?.success) {
        statusText.textContent = "Status: Content script reloaded"
      } else {
        statusText.textContent = `Status: Failed to reload script (${response?.error || "Unknown error"})`
      }
      reloadScriptButton.disabled = false
    })
  })

  // Half basic amount button
  halfBasic.addEventListener("click", () => {
    const currentAmount = Number.parseFloat(basicAmount.value) || 1
    const newAmount = Math.max(0, currentAmount / 2).toFixed(2)
    basicAmount.value = newAmount
    saveBetStrategyValues()
  })

  // Double basic amount button
  doubleBasic.addEventListener("click", () => {
    const currentAmount = Number.parseFloat(basicAmount.value) || 1
    const newAmount = (currentAmount * 2).toFixed(2)
    basicAmount.value = newAmount
    saveBetStrategyValues()
  })

  // Decrease auto cashout button
  decreaseAutoCashout.addEventListener("click", () => {
    const currentCashout = Number.parseFloat(autoCashoutAt.value) || 2
    const newCashout = Math.max(1.01, currentCashout - 0.5).toFixed(2)
    autoCashoutAt.value = newCashout
    saveBetStrategyValues()
  })

  // Increase auto cashout button
  increaseAutoCashout.addEventListener("click", () => {
    const currentCashout = Number.parseFloat(autoCashoutAt.value) || 2
    const newCashout = (currentCashout + 0.5).toFixed(2)
    autoCashoutAt.value = newCashout
    saveBetStrategyValues()
  })

  // Decrease max limit button
  decreaseMaxLimit.addEventListener("click", () => {
    const currentLimit = Number.parseInt(maxLimit.value) || 0
    const newLimit = Math.max(0, currentLimit - 10)
    maxLimit.value = newLimit
    saveBetStrategyValues()
  })

  // Increase max limit button
  increaseMaxLimit.addEventListener("click", () => {
    const currentLimit = Number.parseInt(maxLimit.value) || 0
    const newLimit = currentLimit + 10
    maxLimit.value = newLimit
    saveBetStrategyValues()
  })

  // Decrease min limit button
  decreaseMinLimit.addEventListener("click", () => {
    const currentLimit = Number.parseInt(minLimit.value) || 0
    const newLimit = Math.max(0, currentLimit - 10)
    minLimit.value = newLimit
    saveBetStrategyValues()
  })

  // Increase min limit button
  increaseMinLimit.addEventListener("click", () => {
    const currentLimit = Number.parseInt(minLimit.value) || 0
    const newLimit = currentLimit + 10
    minLimit.value = newLimit
    saveBetStrategyValues()
  })

  // Save bet strategy values when inputs change
  basicAmount.addEventListener("change", saveBetStrategyValues)
  autoCashoutAt.addEventListener("change", saveBetStrategyValues)
  maxLimit.addEventListener("change", saveBetStrategyValues)
  minLimit.addEventListener("change", saveBetStrategyValues)

  // Start/Stop timer button
  startTimer.addEventListener("click", () => {
    if (isAutoBetting) {
      stopAutoBetting()
    } else {
      startAutoBetting()
    }
  })

  // Pagination buttons
  const prevPage = document.getElementById("prevPage")
  const nextPage = document.getElementById("nextPage")
  const pageInfo = document.getElementById("pageInfo")

  prevPage.addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage--
      renderLimboValues()
    }
  })

  nextPage.addEventListener("click", () => {
    if (currentPage < totalPages) {
      currentPage++
      renderLimboValues()
    }
  })

  // Function to start balance check timer
  function startBalanceCheckTimer() {
    if (balanceCheckTimer) {
      clearInterval(balanceCheckTimer)
    }

    // Initial balance check
    getBalanceFunc()

    // Set up periodic balance checks
    balanceCheckTimer = setInterval(() => {
      getBalanceFunc()
    }, 3000) // Check every 3 seconds
  }

  // Function to create the detail modal
  function createDetailModal() {
    // Create modal container if it doesn't exist
    if (!detailModal) {
      detailModal = document.createElement("div")
      detailModal.className = "limbo-detail-modal"
      detailModal.style.display = "none"

      // Add close button
      const closeButton = document.createElement("button")
      closeButton.className = "modal-close-button"
      closeButton.innerHTML = "×"
      closeButton.addEventListener("click", hideDetailModal)

      detailModal.appendChild(closeButton)

      // Add content container
      const contentDiv = document.createElement("div")
      contentDiv.className = "modal-content"
      detailModal.appendChild(contentDiv)

      document.body.appendChild(detailModal)
    }

    return detailModal
  }

  // Function to show detail modal
  function showDetailModal(limboData) {
    if (!detailModal) createDetailModal()

    // Show backdrop
    modalBackdrop.style.display = "block"

    // Populate modal content
    const contentDiv = detailModal.querySelector(".modal-content")

    // Format the date/time
    const date = new Date(limboData.timestamp)
    const formattedDate = date.toLocaleDateString()
    const formattedTime = date.toLocaleTimeString()

    // Create content HTML
    let contentHTML = `
      <div class="modal-header ${getMultiplierClass(limboData.multiplier)}">
        <span class="modal-multiplier">${formatMultiplier(limboData.multiplier)}</span>
      </div>
      <div class="modal-body">
        <div class="modal-row">
          <span class="modal-label">Date/Time:</span>
          <span class="modal-value">${formattedDate} ${formattedTime}</span>
        </div>
    `

    contentHTML += `</div>`
    contentDiv.innerHTML = contentHTML

    // Show the modal
    detailModal.style.display = "block"

    // Add click event to backdrop to close modal
    modalBackdrop.addEventListener("click", hideDetailModal)
  }

  // Function to hide detail modal
  function hideDetailModal() {
    if (detailModal) {
      detailModal.style.display = "none"
      modalBackdrop.style.display = "none"
    }
  }

  // Function to save bet strategy values to localStorage
  function saveBetStrategyValues() {
    localStorage.setItem("basicAmount", basicAmount.value)
    localStorage.setItem("autoCashoutAt", autoCashoutAt.value)
    localStorage.setItem("maxLimit", maxLimit.value)
    localStorage.setItem("minLimit", minLimit.value)
    storedBasicAmount = basicAmount.value
    storedAutoCashoutAt = autoCashoutAt.value
    storedMaxLimit = maxLimit.value
    storedMinLimit = minLimit.value
  }

  // Function to start automatic betting
  function startAutoBetting() {
    const amount = Number.parseFloat(basicAmount.value)
    const cashout = Number.parseFloat(autoCashoutAt.value)
    const maxLimitValue = Number.parseInt(maxLimit.value)
    const minLimitValue = Number.parseInt(minLimit.value)

    if (isNaN(amount) || amount < 0) {
      alert("Please enter a valid basic amount (0 or greater)")
      return
    }

    if (isNaN(cashout) || cashout <= 1) {
      alert("Please enter a valid cashout value (greater than 1)")
      return
    }

    if (isNaN(maxLimitValue) || maxLimitValue <= userBalance) {
      alert("Current balance is above maximum limit!")
      return
    }

    if (isNaN(minLimitValue) || minLimitValue > userBalance) {
      alert("Current balance is below minimum limit!")
      return
    }

    // Save values before starting
    saveBetStrategyValues()

    // Send message to background script to start auto-betting
    chrome.runtime.sendMessage(
      {
        action: "startAutoBetting",
        settings: {
          basicAmount: amount,
          cashoutAt: cashout,
          maxLimit: maxLimitValue,
          minLimit: minLimitValue,
        },
      },
      (response) => {
        if (response?.success) {
          isAutoBetting = true
          isRunning = true
          startTimer.textContent = "Stop Timer"
          startTimer.classList.add("bet-timer-active")
          startTimer.classList.remove("start-timer")
          startTimer.classList.add("stop-timer")
          statusText.textContent = "Status: Auto-betting activated, waiting for current game to end..."

          // Start checking auto-betting status periodically
          startAutoBettingStatusCheck()
          updateStatusUI()
        } else {
          statusText.textContent = `Status: Failed to start auto-betting (${response?.error || "Unknown error"})`
        }
      },
    )
  }

  // Function to stop automatic betting
  function stopAutoBetting() {
    // Send message to background script to stop auto-betting
    chrome.runtime.sendMessage({ action: "stopAutoBetting" }, (response) => {
      if (response?.success) {
        isAutoBetting = false
        isRunning = false
        startTimer.textContent = "Start Timer"
        startTimer.classList.remove("bet-timer-active")
        startTimer.classList.remove("stop-timer")
        startTimer.classList.add("start-timer")
        statusText.textContent = "Status: Auto-betting stopped"

        // Stop checking auto-betting status
        stopAutoBettingStatusCheck()
        updateStatusUI()
      } else {
        statusText.textContent = `Status: Failed to stop auto-betting (${response?.error || "Unknown error"})`
      }
    })
  }

  // Add these new functions:
  let autoBettingStatusTimer = null

  function startAutoBettingStatusCheck() {
    // Clear any existing timer
    if (autoBettingStatusTimer) {
      clearInterval(autoBettingStatusTimer)
    }

    // Check status immediately
    checkAutoBettingStatus()

    // Set up periodic checks
    autoBettingStatusTimer = setInterval(checkAutoBettingStatus, 1000)
  }

  function stopAutoBettingStatusCheck() {
    if (autoBettingStatusTimer) {
      clearInterval(autoBettingStatusTimer)
      autoBettingStatusTimer = null
    }
    clearInterval(autoBettingStatusTimer)
    autoBettingStatusTimer = null
  }

  // Add this new function right after checkAutoBettingStatus
  function updateEnhancedStatusText(baseText, betAmount, streakCount, isDoubleTime) {
    // Create a document fragment to build our enhanced status text
    const fragment = document.createDocumentFragment()

    // Create base text node
    const baseTextNode = document.createTextNode(baseText + " ")
    fragment.appendChild(baseTextNode)

    // Create bet amount span with highlight
    const betAmountSpan = document.createElement("span")
    betAmountSpan.className = "streak-highlight streak-amount"
    betAmountSpan.textContent = `${betAmount}`
    fragment.appendChild(betAmountSpan)

    // Create streak count display if there's a streak
    if (streakCount > 0) {
      // Add spacing
      fragment.appendChild(document.createTextNode(" "))

      // Add streak label
      const streakLabelSpan = document.createElement("span")
      streakLabelSpan.textContent = "Streak:"
      fragment.appendChild(streakLabelSpan)

      // Add streak value with appropriate class based on count
      const streakValueSpan = document.createElement("span")
      streakValueSpan.textContent = ` ${streakCount}`

      // Determine streak class based on count
      let streakClass = "streak-count-1"
      if (streakCount >= 5) {
        streakClass = "streak-count-high"
        streakValueSpan.classList.add("blink") // Add blinking for high streaks
      } else if (streakCount >= 3) {
        streakClass = `streak-count-${streakCount}`
      } else {
        streakClass = `streak-count-${streakCount}`
      }

      streakValueSpan.className = `streak-highlight streak-count ${streakClass}`
      fragment.appendChild(streakValueSpan)
    }

    // Add double time indicator if needed
    if (isDoubleTime) {
      const doubleTimeSpan = document.createElement("span")
      doubleTimeSpan.className = "double-time"
      doubleTimeSpan.textContent = "Double Time"
      fragment.appendChild(doubleTimeSpan)
    }

    // Clear the status text and append our new enhanced content
    statusText.innerHTML = ""
    statusText.appendChild(fragment)
  }

  function checkAutoBettingStatus() {
    chrome.runtime.sendMessage({ action: "getAutoBettingStatus" }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("Error getting auto-betting status:", chrome.runtime.lastError)
        return
      }

      if (response) {
        isAutoBetting = response.isAutoBetting
        currentBetAmount = response.currentBetAmount
        consecutiveFailures = response.consecutiveFailures
        lastBetSuccess = response.lastBetSuccess

        // Update UI based on status
        if (isAutoBetting) {
          startTimer.textContent = "Stop Timer"
          startTimer.classList.add("bet-timer-active")
          startTimer.classList.remove("start-timer")
          startTimer.classList.add("stop-timer")

          if (response.waitingForGameEnd) {
            statusText.textContent = "Status: Waiting for current game to end..."
          } else if (lastBetSuccess) {
            // If last bet was successful, show that we're betting immediately
            updateEnhancedStatusText("Status: Betting immediately after success", currentBetAmount.toFixed(2), 0, false)
          } else {
            // If we're not waiting and not successful, just show basic status
            updateEnhancedStatusText(
              "Status: Auto-betting active",
              currentBetAmount.toFixed(2),
              consecutiveFailures,
              consecutiveFailures >= 3,
            )
          }
        } else {
          startTimer.textContent = "Start Timer"
          startTimer.classList.remove("bet-timer-active")
          startTimer.classList.remove("stop-timer")
          startTimer.classList.add("start-timer")
        }
      }
    })
  }

  // Function to get current balance
  function getBalanceFunc() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].url?.includes("bc.game/game/limbo")) {
        chrome.runtime.sendMessage(
          {
            action: "getBalance",
          },
          (response) => {
            if (response?.success && response.balance !== null) {
              userBalance = response.balance
              currentBalance.textContent = userBalance.toFixed(2)
              balanceLoaded = true
              currentBalance.classList.remove("balance-loading")
              currentBalance.classList.add("balance-loaded")
            } else if (response?.success && response.balance === null) {
              // Balance element not found
              currentBalance.textContent = "No balance"
              currentBalance.classList.remove("balance-loading")
              currentBalance.classList.add("balance-error")
            } else {
              // Error getting balance
              if (!balanceLoaded) {
                currentBalance.textContent = "Loading..."
                currentBalance.classList.add("balance-loading")
                currentBalance.classList.remove("balance-loaded", "balance-error")
              }
            }
          },
        )
      } else {
        currentBalance.textContent = "Not on BC Game limbo page"
        currentBalance.classList.remove("balance-loading", "balance-loaded")
        currentBalance.classList.add("balance-error")
      }
    })
  }

  // Download JSON data button
  downloadData.addEventListener("click", () => {
    statusText.textContent = "Status: Preparing JSON download..."
    chrome.runtime.sendMessage({ action: "downloadHistory" }, (response) => {
      if (response?.success) {
        // Convert to a format that includes all data
        const exportData = response.data.map((item) => {
          const date = new Date(item.timestamp)
          return {
            dateTime: `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`,
            multiplier: formatMultiplierForExport(item.multiplier),
          }
        })

        const dataStr = JSON.stringify(exportData, null, 2)
        const dataBlob = new Blob([dataStr], { type: "application/json" })
        const url = URL.createObjectURL(dataBlob)

        const a = document.createElement("a")
        a.href = url
        a.download = response.filename
        a.click()

        URL.revokeObjectURL(url)
        statusText.textContent = "Status: JSON download complete"
      } else {
        statusText.textContent = "Status: Download failed"
      }
    })
  })

  // Download CSV data button
  downloadCSV.addEventListener("click", () => {
    statusText.textContent = "Status: Preparing CSV download..."
    chrome.runtime.sendMessage({ action: "downloadHistory" }, (response) => {
      if (response?.success) {
        // Convert JSON data to CSV with additional fields
        const csvData = convertToCSV(response.data)
        const dataBlob = new Blob([csvData], { type: "text/csv" })
        const url = URL.createObjectURL(dataBlob)

        const a = document.createElement("a")
        a.href = url
        a.download = response.filename.replace(".json", ".csv")
        a.click()

        URL.revokeObjectURL(url)
        statusText.textContent = "Status: CSV download complete"
      } else {
        statusText.textContent = "Status: Download failed"
      }
    })
  })

  // Function to format multiplier with 2 decimal places for export
  function formatMultiplierForExport(value) {
    // Format to always show 2 decimal places
    return Number(value).toFixed(2)
  }

  // Function to convert JSON data to CSV
  function convertToCSV(data) {
    if (!data || data.length === 0) return "No data"

    // CSV header - include all available data
    let csv = "Date/Time,Multiplier\n"

    // Sort data by timestamp (newest first)
    const sortedData = [...data].sort((a, b) => b.timestamp - a.timestamp)

    // Add each row
    sortedData.forEach((item) => {
      const date = new Date(item.timestamp)
      const dateTimeStr = `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`
      const formattedMultiplier = formatMultiplierForExport(item.multiplier)

      csv += `"${dateTimeStr}",${formattedMultiplier},"${betAmount}",${failedStreak},${betResult}\n`
    })

    return csv
  }

  // Clear data button
  clearData.addEventListener("click", () => {
    if (confirm("Are you sure you want to clear all limbo history data?")) {
      statusText.textContent = "Status: Clearing data..."
      chrome.runtime.sendMessage({ action: "clearHistory" }, (response) => {
        if (response?.success) {
          loadHistory()
          lastUpdateTime = new Date()
          updateLastUpdatedText()
          statusText.textContent = "Status: Data cleared"
        } else {
          statusText.textContent = "Status: Failed to clear data"
        }
      })
    }
  })

  function updateStatusUI() {
    const historyCount = limboHistory.length

    // Only update the status text if we're not in the middle of an operation
    if (
      !statusText.textContent.includes("Starting") &&
      !statusText.textContent.includes("Stopping") &&
      !statusText.textContent.includes("Placing") &&
      !statusText.textContent.includes("Refreshing") &&
      !statusText.textContent.includes("Reloading") &&
      !statusText.textContent.includes("Preparing") &&
      !statusText.textContent.includes("Clearing")
    ) {
      statusText.textContent = `Status: ${isRunning ? "Running" : "Stopped"}`
      if (historyCount > 0) {
        statusText.textContent += ` (${historyCount} values collected)`
      }
    }

    statusBadge.textContent = isRunning ? "Active" : "Inactive"
    statusBadge.className = isRunning ? "status-badge active" : "status-badge"
  }

  function formatMultiplier(value) {
    // Format to always show 2 decimal places
    return `${Number(value).toFixed(2)}x`
  }

  function getMultiplierClass(value) {
    // Changed color scheme as requested:
    // Low (<2x): red
    // Medium (2x-10x): green
    // High (>=10x): yellow/orange
    if (value >= 10) {
      return "high" // yellow/orange for high values
    } else if (value >= 2) {
      return "medium" // green for medium values
    } else {
      return "low" // red for low values
    }
  }

  function updateStatistics(history) {
    if (!history || history.length === 0) {
      totalCount.textContent = "0"
      lowCount.textContent = "0"
      mediumCount.textContent = "0"
      highCount.textContent = "0"
      lowPercent.textContent = "(0.00%)"
      mediumPercent.textContent = "(0.00%)"
      highPercent.textContent = "(0.00%)"
      return
    }

    const allValues = history.length
    let lowTotal = 0
    let mediumTotal = 0
    let highTotal = 0

    history.forEach((item) => {
      const value = item.multiplier
      if (value >= 10) {
        highTotal++
        mediumTotal++ // Count high values in medium as well
      } else if (value >= 2) {
        mediumTotal++
      } else {
        lowTotal++
      }
    })

    // Calculate the total as red + green
    const total = lowTotal + mediumTotal

    // Calculate percentages with 2 decimal precision
    const lowPercentValue = total > 0 ? ((lowTotal / total) * 100).toFixed(2) : "0.00"
    const greenPercentValue = total > 0 ? ((mediumTotal / total) * 100).toFixed(2) : "0.00"
    const highPercentValue = total > 0 ? ((highTotal / total) * 100).toFixed(2) : "0.00"

    totalCount.textContent = total.toString()
    lowCount.textContent = lowTotal.toString()
    mediumCount.textContent = mediumTotal.toString()
    highCount.textContent = highTotal.toString()
    lowPercent.textContent = `(${lowPercentValue}%)`
    mediumPercent.textContent = `(${greenPercentValue}%)`
    highPercent.textContent = `(${highPercentValue}%)`
  }

  function renderLimboValues() {
    if (!limboHistory || limboHistory.length === 0) {
      multiplierList.innerHTML = ""
      const noDataDiv = document.createElement("div")
      noDataDiv.className = "no-data-message"
      noDataDiv.textContent = "No limbo data collected yet."
      multiplierList.appendChild(noDataDiv)
      updatePagination(0)
      return
    }

    // Sort by timestamp in descending order (newest first)
    const sortedItems = [...limboHistory].sort((a, b) => b.timestamp - a.timestamp)

    // Calculate pagination
    const startIndex = (currentPage - 1) * itemsPerPage
    const endIndex = Math.min(startIndex + itemsPerPage, sortedItems.length)
    const pageItems = sortedItems.slice(startIndex, endIndex)

    // Update pagination controls
    updatePagination(sortedItems.length)

    // Clear the multiplier list
    multiplierList.innerHTML = ""

    // Render the items for the current page
    pageItems.forEach((item, index) => {
      const multiplierItem = document.createElement("div")
      multiplierItem.className = "multiplier-item"
      multiplierItem.dataset.index = startIndex + index // Store the index for reference

      // Add 'latest' class to the first item on the first page
      if (index === 0 && currentPage === 1) {
        multiplierItem.className += " latest"
      }

      // Create multiplier value span
      const multiplierSpan = document.createElement("span")
      const valueClass = getMultiplierClass(item.multiplier)
      multiplierSpan.className = `multiplier-value ${valueClass}`
      multiplierSpan.textContent = formatMultiplier(item.multiplier)

      // Add click event to show modal
      multiplierItem.addEventListener("click", () => {
        showDetailModal(item)
      })

      // Add multiplier value to the item
      multiplierItem.appendChild(multiplierSpan)
      multiplierList.appendChild(multiplierItem)
    })

    // Update status with count
    updateStatusUI()
  }

  // Create modal on page load
  createDetailModal()

  // Set initial button styles
  startTimer.classList.add("start-timer")
})
