// Stocke les sessions actives
let activeSessions = new Map();

// Crée un menu contextuel (clic droit) pour ouvrir un lien dans une session temporaire isolée
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "openIsolatedTab",
        title: "Ouvrir dans une session temporaire isolée",
        contexts: ["link"]
    });
});

// Gère les clics sur le menu contextuel
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "openIsolatedTab") {
        chrome.tabs.create({
            url: info.linkUrl,
            active: true
        }, (newTab) => {
            if (chrome.runtime.lastError) {
                console.error("Erreur lors de la création de l'onglet : ", chrome.runtime.lastError.message);
                return;
            }
            createTemporarySession(newTab.id);  // Utilise l'ID de l'onglet
        });
    }
});

// Gère la création d'une session temporaire pour un onglet donné
async function createTemporarySession(tabId) {
    let sessionId = `session-${tabId}-${Date.now()}`;
    activeSessions.set(tabId, sessionId);

    try {
        // Initialiser les cookies comme un objet et non une chaîne
        await chrome.storage.local.set({ [sessionId]: {} });
        console.log(`Session temporaire créée pour l'onglet ${tabId}`);
    } catch (error) {
        console.error("Erreur lors de la sauvegarde dans le stockage : ", error.message);
    }
}


// Capture les cookies lorsqu'ils sont modifiés et les stocke pour l'onglet actif
chrome.cookies.onChanged.addListener((changeInfo) => {
    if (changeInfo.removed) return;  // Ignore si le cookie est supprimé

    let cookie = changeInfo.cookie;

    // Exclure github.com des modifications de cookies
    if (cookie.domain.includes("github.com")) {
        console.log("Cookies GitHub ignorés");
        return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        if (!tabs.length) return;

        let tabId = tabs[0].id;
        let sessionId = activeSessions.get(tabId);

        if (sessionId) {
            try {
                let result = await chrome.storage.local.get([sessionId]);
                let storedCookies = result[sessionId] || "";
                // Ajoute le cookie au format clé=valeur;domaine
                storedCookies += `${cookie.name}=${cookie.value};${cookie.domain} `;
                await chrome.storage.local.set({ [sessionId]: storedCookies });

                console.log(`Cookies stockés pour l'onglet ${tabId} : ${storedCookies}`);
            } catch (error) {
                console.error("Erreur lors de la mise à jour des cookies : ", error.message);
            }
        }
    });
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
    let tabId = activeInfo.tabId;
    let sessionId = activeSessions.get(tabId);

    if (sessionId) {
        chrome.tabs.get(tabId, async (tab) => {
            if (tab.url.includes("github.com")) {
                console.log("Règles dynamiques ignorées pour GitHub");
                return;
            }

            try {
                let result = await chrome.storage.local.get([sessionId]);
                let cookies = result[sessionId] || "";

                console.log(`Mise à jour des règles dynamiques pour l'onglet ${tabId} avec les cookies : ${cookies}`);

                chrome.declarativeNetRequest.updateDynamicRules({
                    addRules: [
                        {
                            id: tabId,
                            priority: 1,
                            action: {
                                type: "modifyHeaders",
                                requestHeaders: [
                                    {
                                        header: "Cookie",
                                        operation: "set",
                                        value: cookies
                                    }
                                ]
                            },
                            condition: {
                                urlFilter: "*",
                                resourceTypes: ["main_frame"]
                            }
                        }
                    ],
                    removeRuleIds: [tabId]
                });
            } catch (error) {
                console.error("Erreur lors de la mise à jour des règles dynamiques : ", error.message);
            }
        });
    }
});

// Nettoie les cookies liés à une session temporaire lorsque l'onglet est fermé
chrome.tabs.onRemoved.addListener((closedTabId) => {
    if (activeSessions.has(closedTabId)) {
        let sessionId = activeSessions.get(closedTabId);
        activeSessions.delete(closedTabId);
        console.log(`Onglet ${closedTabId} fermé, début du nettoyage des cookies pour la session ${sessionId}`);
        cleanSessionCookies(sessionId);

        // Supprime la règle dynamique pour cet onglet
        chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: [closedTabId]
        });
    }
});

async function cleanSessionCookies(sessionId) {
    try {
        let result = await chrome.storage.local.get([sessionId]);
        let cookies = result[sessionId];

        if (!cookies) {
            console.error(`Cookies pour la session ${sessionId} non trouvés.`);
            await chrome.storage.local.remove(sessionId);
            return;
        }

        // Supprime tous les cookies de la session
        let cookiePairs = cookies.split(" ");
        for (let cookiePair of cookiePairs) {
            let [cookieNameValue, cookieDomain] = cookiePair.split(";");
            let [cookieName] = cookieNameValue.split("=");
            if (cookieName && cookieDomain) {
                await chrome.cookies.remove({
                    url: `https://${cookieDomain}`,
                    name: cookieName
                });
            }
        }

        console.log(`Cookies nettoyés pour la session ${sessionId}`);
        await chrome.storage.local.remove(sessionId);
        console.log(`Entrée de stockage supprimée pour la session ${sessionId}`);
    } catch (error) {
        console.error("Erreur lors du nettoyage des cookies : ", error.message);
    }
}