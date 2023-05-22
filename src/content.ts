console.log("THIS IS THE CONTENT SCRIPT GUYS");

function activityDetected(event) {
  if (event.type === "mousemove") {
    console.log("mouse has moved");
  } else if (event.type === "blur") {
    console.log("window has blurred");
  } else if (event.type === "visibilitychange") {
    console.log("visibility has changed");
  } else if (event.type === "keydown") {
    console.log("key was pressed");
  }

  chrome.runtime.sendMessage({ type: "userActive" });
}

// Add event listeners for user interactions
document.addEventListener("mousemove", activityDetected);
document.addEventListener("keydown", activityDetected);
document.addEventListener("visibilitychange", activityDetected);
window.addEventListener("blur", activityDetected);

document.addEventListener("mouseup", function () {
  const selectedText = window.getSelection().toString().trim();

  if (selectedText) {
    console.log("Selected text:", selectedText);
    // You can add your custom logic or call a function here
  }
});
