/**
 * RSA COMMAND CENTER - FULLY OPTIMIZED APPS SCRIPT
 */

function doGet(e) {
  var trackingSheetId = '1MOF5wsDYuup4L3pV26PZpFxbMC0LzcYEYk7SQ3HM9sc'; 
  var trackingSpreadsheet = SpreadsheetApp.openById(trackingSheetId);
  
  var escalationSheetId = '1EqirelmIu_betev6QDNrmJuNROVJDx96cjOGGfarQ2Y';
  var escalationSpreadsheet = SpreadsheetApp.openById(escalationSheetId);
  
  var today = new Date();
  var dateString = Utilities.formatDate(today, 'GMT+5:30', 'dd-MM-yyyy');
  var sheet = trackingSpreadsheet.getSheetByName(dateString);
  var alertsSheet = trackingSpreadsheet.getSheetByName('Alerts');
  
  // Getting the first tab of the Escalated Cases workbook
  var escalatedSheet = escalationSpreadsheet.getSheets()[0];
  
  // Load Escalated Cases Map
  var escalatedMap = {};
  if (escalatedSheet) {
    try {
      var escData = escalatedSheet.getDataRange().getValues();
      var escHeaders = escData[0] || [];
      var escVehCol = -1;
      var escLevelCol = -1;
      for (var eh = 0; eh < escHeaders.length; eh++) {
        var eName = String(escHeaders[eh]).trim().toLowerCase();
        if (eName === 'vehicle no' || eName === 'vehicle number') escVehCol = eh;
        if (eName === 'level') escLevelCol = eh;
      }
      if (escVehCol !== -1 && escLevelCol !== -1) {
        for (var er = 1; er < escData.length; er++) {
          var ev = String(escData[er][escVehCol] || "").toUpperCase().replace(/\s+/g, '');
          var el = String(escData[er][escLevelCol] || "").trim();
          if (ev.length > 3) {
            escalatedMap[ev] = el;
          }
        }
      }
    } catch(err) {} // Fail gracefully if missing
  }

  // 1. Fetch Active Manual Alerts
  var activeAlerts = [];
  try {
    if (alertsSheet) {
      var alertData = alertsSheet.getDataRange().getValues();
      for (var a = 1; a < alertData.length; a++) {
         if (alertData[a][1]) {
             activeAlerts.push({
                timestamp: alertData[a][0],
                agentName: alertData[a][1],
                vehicleNumber: alertData[a][2],
                requirement: alertData[a][3]
             });
         }
      }
    }
  } catch (err) {}

  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify({ agents: [], alerts: activeAlerts })).setMimeType(ContentService.MimeType.JSON);
  }
  
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) { 
    return ContentService.createTextOutput(JSON.stringify({ agents: [], alerts: activeAlerts })).setMimeType(ContentService.MimeType.JSON);
  }
  
  var headers = data[0];
  var nameColIndex = -1;
  var statusColIndex = -1;
  var vehicleColIndex = -1;
  var vinColIndex = -1;
  var ticketStatusColIndex = -1;
  var pickTimeColIndex = -1;
  
  // Dynamic Header Lookup
  for (var h = 0; h < headers.length; h++) {
    var headerName = String(headers[h]).trim().toLowerCase();
    if (headerName === 'name') nameColIndex = h; 
    if (headerName === 'status') statusColIndex = h;
    if (headerName === 'vehicle number') vehicleColIndex = h;
    // Allow typical VIN variations
    if (headerName === 'vin number' || headerName === 'vim number' || headerName === 'vin') vinColIndex = h;
    if (headerName === 'ticket status') ticketStatusColIndex = h;
    if (headerName === 'date' || headerName === 'pick time' || headerName === 'last pick time') pickTimeColIndex = h;
  }
  
  if (nameColIndex === -1) {
    return ContentService.createTextOutput(JSON.stringify({ agents: [], alerts: activeAlerts })).setMimeType(ContentService.MimeType.JSON);
  }

  // --- Helper Date Parser ---
  function parseCustomDate(dateVal) {
    if (!dateVal) return null;
    
    // If Apps Script successfully parsed it natively
    if (Object.prototype.toString.call(dateVal) === "[object Date]") {
      if (!isNaN(dateVal.getTime())) return dateVal;
    }
    
    // Manual String Parsing for cases like 10/03/2026 21:55:36
    var str = String(dateVal).trim();
    var parts = str.split(' ');
    var dtStr = parts[0]; 
    var tmStr = parts[1] || "00:00:00";
    
    var dArr = dtStr.split(/[-/]/);
    if (dArr.length === 3) {
      var p1 = parseInt(dArr[0], 10);
      var p2 = parseInt(dArr[1], 10);
      var y = parseInt(dArr[2], 10);
      if (y < 100) y += 2000;
      
      var m, d;
      // Resolve month vs day logic
      if (p1 > 12) {
        d = p1; m = p2;
      } else if (p2 > 12) {
        m = p1; d = p2;
      } else {
        // Fallback guess: treat as MM/DD
        m = p1; d = p2; 
      }
      
      var tArr = tmStr.split(':');
      var hr = parseInt(tArr[0], 10) || 0;
      var min = parseInt(tArr[1], 10) || 0;
      var sec = parseInt(tArr[2], 10) || 0;
      
      return new Date(y, m - 1, d, hr, min, sec);
    }
    
    var fallback = new Date(str);
    if (!isNaN(fallback.getTime())) return fallback;
    return null;
  }

  // Strictly identify real vehicle/VIN targets and ignore pure text, phone numbers, and blanks
  function isRealVehicleRecord(val) {
    if (!val) return false;
    
    // Clean string by removing ALL whitespace everywhere
    var s = String(val).toUpperCase().replace(/\s+/g, '');
    
    // Exact Regex for Indian Vehicle Numbers (e.g. GJ06RB2631, MH041234, DL10CX8358)
    // Matches: 2 Letters + 1-2 Digits + 0-3 Letters + 1-4 Digits ending the string
    var vrnRegex = /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}$/;
    
    // Exact Regex for standard VIN / VIM Numbers (exactly 17 letters and numbers)
    // Characters I, O, Q are technically not allowed in true VINs, but we'll allow standard A-Z for flexibility.
    var vinRegex = /^[A-Z0-9]{17}$/;
    
    return vrnRegex.test(s) || vinRegex.test(s);
  }

  var agentsMap = {};
  var nowMs = new Date().getTime(); // Used to ensure "Date" falls logically
  
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var rawName = row[nameColIndex];
    
    var veh = vehicleColIndex !== -1 ? String(row[vehicleColIndex] || "").trim() : "";
    var vin = vinColIndex !== -1 ? String(row[vinColIndex] || "").trim() : "";
    
    // 1. Validation Rule: ONLY count if Vehicle Number OR VIN Number is present!
    // Using intelligent real vehicle record checks to ignore text inputs (N/A, Customer names) and phone numbers
    var hasValidCase = isRealVehicleRecord(veh) || isRealVehicleRecord(vin);

    var nameStr = String(rawName || "").trim().toUpperCase();
    if (!nameStr || nameStr === "NAME") continue;
    
    // Ignore rows logically without a valid vehicle or vin
    if (!hasValidCase) continue;
    
    // Normalize Agent Name Display
    var agentName = String(rawName).toLowerCase().split(' ').map(function(word) {
      return word ? word.charAt(0).toUpperCase() + word.slice(1) : "";
    }).join(' ').trim();

    if (!agentsMap[agentName]) {
      agentsMap[agentName] = { 
        "Name": agentName, 
        "TotalCases": 0, "ROS": 0, "Towing": 0, "Assigned": 0, "Dealer": 0, "Failed": 0,
        "ON GOING": 0, "possible escalation": 0, "CANCELLED": 0, "POSTPONED": 0, "CLOSED": 0, "PRECLOSE": 0,
        "Date": null, 
        "_maxTimeMs": 0 
      };
    }

    var agent = agentsMap[agentName];
    // Since it passed the `hasValidCase` earlier, we count this as a case!
    agent["TotalCases"]++;

    // 2. Process Categorical Mappings based on 'Status' column requirements
    var status = (statusColIndex !== -1) ? String(row[statusColIndex]).trim().toUpperCase() : "";
    // Handle double-spaces occasionally found in sheets (i.e. 'ROS  FAILED')
    var cleanStatus = status.replace(/\s+/g, " ");
    
    // ROS Map
    if (cleanStatus === "TECH ASSIGNED" || cleanStatus === "ROS DONE") {
      agent["ROS"]++;
    } 
    // Tow Map
    else if (cleanStatus === "TOWING ASSIGNED" || 
             cleanStatus === "TOWING & CUSTODY ASSIGNED" || 
             cleanStatus === "ROS FAILED - TOWING & CUSTODY ASSIGNED" || 
             cleanStatus === "VEHICLE DROPPED") {
      agent["Towing"]++;
    } 
    // Dealer Map
    else if (cleanStatus === "DEALER TECHNICIAN ASSIGNED" || cleanStatus === "RESOLVED BY DEALER") {
      agent["Dealer"]++;
    }

    // 3. Process Live Pop-Up Alert Triggers based on statuses
    if (cleanStatus === "TECH UNASSIGNED" || 
        cleanStatus === "TOWING UNASSIGNED" || 
        cleanStatus === "REQUIRED DEALER SUPPORT" || 
        cleanStatus === "ROS FAILED - UNABLE TO ASSIGN SERVICE" || 
        cleanStatus === "CUSTOMER WILL ESCALATE") {
        
        // We append "LIVE_" so the frontend knows this alert is dynamically fetched
        var liveId = "LIVE_ROW" + i + "_" + cleanStatus.replace(/ /g, "_");
        activeAlerts.push({
            timestamp: liveId,
            agentName: agentName,
            vehicleNumber: veh || vin || "N/A",
            requirement: status
        });
    }

    // Process Escalation Alert Cross-Check
    var cleanVeh = veh.toUpperCase().replace(/\s+/g, '');
    var cleanVin = vin.toUpperCase().replace(/\s+/g, '');
    var matchedEscalationLevel = escalatedMap[cleanVeh] || escalatedMap[cleanVin] || null;

    if (matchedEscalationLevel) {
        var foundVeh = escalatedMap[cleanVeh] ? veh : vin;
        var escId = "LIVE_ESC_ROW" + i + "_" + foundVeh.replace(/\s+/g, '');
        activeAlerts.push({
            timestamp: escId,
            agentName: agentName,
            vehicleNumber: foundVeh,
            requirement: matchedEscalationLevel, 
            isEscalation: true
        });
    }

    // 4. Ticket Status Requirements
    if (ticketStatusColIndex !== -1) {
      var tStatus = String(row[ticketStatusColIndex]).trim().toUpperCase();
      if (tStatus === "ON GOING") agent["ON GOING"]++;
      else if (tStatus === "POSSIBLE ESCALATION" || tStatus.indexOf("POSSIBLE") > -1) agent["possible escalation"]++; 
      else if (tStatus === "CANCEL" || tStatus === "CANCELLED") agent["CANCELLED"]++; 
      else if (tStatus === "POSTPONED") agent["POSTPONED"]++;
      else if (tStatus === "CLOSED") agent["CLOSED"]++;
      else if (tStatus === "PRECLOSE") agent["PRECLOSE"]++;
    }

    // 5. Date processing logic (Avoid "invalid" or "just now" glitches)
    if (pickTimeColIndex !== -1 && row[pickTimeColIndex]) {
      var parsedDate = parseCustomDate(row[pickTimeColIndex]);
      if (parsedDate) {
        var timeMs = parsedDate.getTime();
        
        // Anti-Future glitch check: if somehow it parsed as a future hour due to sheet glitches:
        if (timeMs > nowMs) {
            // Attempt swapping day and month if it's over the limit
            var fixD = new Date(parsedDate.getFullYear(), parsedDate.getDate() - 1, parsedDate.getMonth() + 1, parsedDate.getHours(), parsedDate.getMinutes(), parsedDate.getSeconds());
            if (fixD.getTime() <= nowMs && fixD.getTime() > agent["_maxTimeMs"]) {
               agent["_maxTimeMs"] = fixD.getTime();
               agent["Date"] = fixD.toISOString();
            } else if (timeMs > agent["_maxTimeMs"]) {
               agent["_maxTimeMs"] = timeMs;
               agent["Date"] = parsedDate.toISOString();
            }
        } else if (timeMs > agent["_maxTimeMs"]) {
            // Normal track - keep highest correct past time
            agent["_maxTimeMs"] = timeMs;
            // .toISOString() format handles easily for JS `new Date()` calculations!
            agent["Date"] = parsedDate.toISOString();
        }
      }
    }
  }
  
  // Format Payload Finalizer
  var result = [];
  for (var key in agentsMap) {
    delete agentsMap[key]["_maxTimeMs"]; // Clean temp tracker
    if (agentsMap[key]["TotalCases"] > 0) {
      result.push(agentsMap[key]);
    }
  }
  
  return ContentService.createTextOutput(JSON.stringify({ agents: result, alerts: activeAlerts }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var action = e.parameter.action;
  if (action === 'clearAlert') {
    var timestamp = e.parameter.timestamp;
    var sheet = SpreadsheetApp.openById('1MOF5wsDYuup4L3pV26PZpFxbMC0LzcYEYk7SQ3HM9sc').getSheetByName('Alerts');
    
    // Only target clearing alerts that are manually input in DB!
    if (sheet && String(timestamp).indexOf("LIVE_") === -1) {
      var vals = sheet.getDataRange().getValues();
      for (var i = 1; i < vals.length; i++) {
        if (String(vals[i][0]) === String(timestamp)) {
          sheet.deleteRow(i + 1);
          break;
        }
      }
    }
  }
  return ContentService.createTextOutput("Success");
}
