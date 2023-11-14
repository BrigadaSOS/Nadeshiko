chrome.runtime.onInstalled.addListener(async (opt) => {
  if (opt.reason === 'install') {
    await chrome.storage.local.clear()

    chrome.tabs.create({
      active: true,
      url: chrome.runtime.getURL('./installed.html'),
    })
  }
})

chrome.runtime.onMessageExternal.addListener(
  (message, sender, sendResponse) => {
    sendResponse({ status: 'Success', data: message.data });
    return true; 
  }
);


console.log('hello world from background')

export {}
