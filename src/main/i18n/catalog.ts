// Main-process (backend) localization catalog.
//
// Chinese (zh) is the source language and the default — the project owner ships
// a Chinese-first product, so any key missing from another language falls back
// to zh (see ./index.ts). The keys below cover the backend strings that surface
// directly in the UI: model/network error messages, the "no credentials" prompt,
// the startup-failure dialog, and the default config-set name.
//
// Placeholders use the {{name}} syntax and are interpolated by mt(); `\n`
// produces a real newline at runtime, and leading/trailing underscores are
// markdown italics rendered by the chat view.

export type BackendMessageKey =
  | 'errModelTimeout'
  | 'errEmptySuccess'
  | 'errContextOverflow'
  | 'errBadRequest'
  | 'errAuthFailed'
  | 'errRateLimited'
  | 'errUpstreamError'
  | 'errNetworkInterrupted'
  | 'errCheckConfigHint'
  | 'errRetryingHint'
  | 'errConfigRequired'
  | 'noticeCompactionStart'
  | 'noticeCompactionFailed'
  | 'noticeCompactionCompleted'
  | 'noticeHandoffStart'
  | 'noticeHandoffFailed'
  | 'startupFailedTitle'
  | 'startupFailedBody'
  | 'configDefaultSetName'
  | 'configFallbackSetName';

export type BackendMessages = Record<BackendMessageKey, string>;

export const SUPPORTED_BACKEND_LANGUAGES = [
  'en',
  'zh',
  'es',
  'fr',
  'de',
  'it',
  'uk',
  'pl',
  'sv',
  'no',
  'nl',
  'ro',
] as const;

export const DEFAULT_BACKEND_LANGUAGE = 'zh';

export const backendCatalog: Record<string, BackendMessages> = {
  zh: {
    errModelTimeout: '模型响应超时：长时间未收到上游返回，请稍后重试或检查当前模型/网关负载。',
    errEmptySuccess:
      '模型返回了一个空的成功结果，当前模型或网关兼容性可能有问题，请重试或切换协议后再试。',
    errContextOverflow:
      '对话上下文已满。请开始新的对话，或减少消息长度，或在 API 设置中降低最大输出 tokens。（限制：{{limit}} tokens，已用：{{input}} input + {{output}} output）',
    errBadRequest:
      '请求被上游拒绝（400），可能是模型/协议配置不兼容。请检查模型名称、协议设置和 API 端点。\n原始错误: {{error}}',
    errAuthFailed:
      '认证失败，请检查 API Key 是否正确、是否已过期或无权访问当前模型。\n原始错误: {{error}}',
    errRateLimited:
      '请求被限流（429），当前模型或 API 端点的调用频率已达上限，请稍后重试。\n原始错误: {{error}}',
    errUpstreamError:
      '上游服务异常，可能是模型服务过载或临时故障，SDK 将自动重试。\n原始错误: {{error}}',
    errNetworkInterrupted: '网络连接中断（{{error}}），可能是代理/网关不稳定，SDK 将自动重试。',
    errCheckConfigHint: '_请检查配置后重试。_',
    errRetryingHint: '_Agent 正在自动重试，请稍候..._',
    errConfigRequired: '当前方案未配置可用凭证，请先在 API 设置中完成配置',
    noticeCompactionStart: '正在压缩对话上下文以释放空间...',
    noticeCompactionFailed: '上下文压缩失败：{{error}}',
    noticeCompactionCompleted: '上下文压缩完成，正在继续处理请求。',
    noticeHandoffStart: '正在总结当前对话，以便在新会话中继续…',
    noticeHandoffFailed: '会话交接失败：{{error}}',
    startupFailedTitle: 'Open Cowork 启动失败',
    startupFailedBody: '{{message}}\n\n请查看日志获取更多信息。',
    configDefaultSetName: '默认方案',
    configFallbackSetName: '方案 {{index}}',
  },
  en: {
    errModelTimeout:
      'Model response timed out: no reply from the upstream service for a while. Please retry later or check the current model/gateway load.',
    errEmptySuccess:
      'The model returned an empty successful result. The current model or gateway may have a compatibility issue — please retry or switch protocol and try again.',
    errContextOverflow:
      'The conversation context is full. Start a new conversation, shorten your messages, or lower max output tokens in API Settings. (Limit: {{limit}} tokens, used: {{input}} input + {{output}} output)',
    errBadRequest:
      'The request was rejected upstream (400). The model/protocol configuration may be incompatible. Please check the model name, protocol settings and API endpoint.\nOriginal error: {{error}}',
    errAuthFailed:
      'Authentication failed. Please check whether the API Key is correct, has expired, or lacks access to the current model.\nOriginal error: {{error}}',
    errRateLimited:
      'The request was rate limited (429). The current model or API endpoint has reached its call-rate limit. Please retry later.\nOriginal error: {{error}}',
    errUpstreamError:
      'The upstream service returned an error — the model service may be overloaded or temporarily unavailable. The SDK will retry automatically.\nOriginal error: {{error}}',
    errNetworkInterrupted:
      'The network connection was interrupted ({{error}}). The proxy/gateway may be unstable. The SDK will retry automatically.',
    errCheckConfigHint: '_Please check your configuration and retry._',
    errRetryingHint: '_The agent is retrying automatically, please wait..._',
    errConfigRequired:
      'The current configuration set has no usable credentials. Please complete the setup in API Settings first.',
    noticeCompactionStart: 'Compacting conversation context to free space...',
    noticeCompactionFailed: 'Context compaction failed: {{error}}',
    noticeCompactionCompleted: 'Context compaction completed. Continuing the request.',
    noticeHandoffStart: 'Summarizing this conversation for a new session…',
    noticeHandoffFailed: 'Session handoff failed: {{error}}',
    startupFailedTitle: 'Open Cowork failed to start',
    startupFailedBody: '{{message}}\n\nPlease check the logs for more information.',
    configDefaultSetName: 'Default',
    configFallbackSetName: 'Configuration {{index}}',
  },
  es: {
    errModelTimeout:
      'Se agotó el tiempo de espera de la respuesta del modelo: el servicio remoto no respondió durante un rato. Vuelve a intentarlo más tarde o revisa la carga actual del modelo o la pasarela.',
    errEmptySuccess:
      'El modelo devolvió un resultado correcto pero vacío. Es posible que el modelo o la pasarela actual tengan un problema de compatibilidad; vuelve a intentarlo o cambia de protocolo e inténtalo de nuevo.',
    errContextOverflow:
      'El contexto de la conversación está lleno. Inicia una conversación nueva, acorta los mensajes o reduce los tokens máximos de salida en los Ajustes de la API. (Límite: {{limit}} tokens, usado: {{input}} input + {{output}} output)',
    errBadRequest:
      'El servicio remoto rechazó la solicitud (400). Puede que la configuración del modelo o el protocolo sea incompatible. Comprueba el nombre del modelo, los ajustes del protocolo y el endpoint de la API.\nError original: {{error}}',
    errAuthFailed:
      'Error de autenticación. Comprueba si la API Key es correcta, ha caducado o no tiene acceso al modelo actual.\nError original: {{error}}',
    errRateLimited:
      'Se limitó la frecuencia de la solicitud (429). El modelo o el endpoint de la API actual alcanzó su límite de frecuencia de llamadas. Vuelve a intentarlo más tarde.\nError original: {{error}}',
    errUpstreamError:
      'El servicio remoto devolvió un error: puede que el servicio del modelo esté sobrecargado o no esté disponible temporalmente. El SDK reintentará automáticamente.\nError original: {{error}}',
    errNetworkInterrupted:
      'Se interrumpió la conexión de red ({{error}}). Puede que el proxy o la pasarela sean inestables. El SDK reintentará automáticamente.',
    errCheckConfigHint: '_Comprueba tu configuración y vuelve a intentarlo._',
    errRetryingHint: '_El agente está reintentando automáticamente, espera un momento..._',
    errConfigRequired:
      'El conjunto de configuración actual no tiene credenciales utilizables. Completa primero la configuración en los Ajustes de la API.',
    noticeCompactionStart: 'Compactando el contexto de la conversación para liberar espacio...',
    noticeCompactionFailed: 'Error al compactar el contexto: {{error}}',
    noticeCompactionCompleted: 'Compactación del contexto completada. Continuando la solicitud.',
    noticeHandoffStart: 'Resumiendo esta conversación para una nueva sesión…',
    noticeHandoffFailed: 'Error al transferir la sesión: {{error}}',
    startupFailedTitle: 'No se pudo iniciar Open Cowork',
    startupFailedBody: '{{message}}\n\nConsulta los registros para obtener más información.',
    configDefaultSetName: 'Predeterminada',
    configFallbackSetName: 'Configuración {{index}}',
  },
  fr: {
    errModelTimeout:
      "Le délai d'attente de la réponse du modèle a expiré : aucune réponse du service en amont depuis un certain temps. Veuillez réessayer plus tard ou vérifier la charge actuelle du modèle ou de la passerelle.",
    errEmptySuccess:
      'Le modèle a renvoyé un résultat vide alors que la requête a abouti. Le modèle ou la passerelle actuels présentent peut-être un problème de compatibilité — veuillez réessayer ou changer de protocole, puis recommencer.',
    errContextOverflow:
      "Le contexte de la conversation est plein. Démarrez une nouvelle conversation, réduisez la taille des messages ou diminuez les tokens de sortie maximaux dans les Paramètres de l'API. (Limite : {{limit}} tokens, utilisé : {{input}} input + {{output}} output)",
    errBadRequest:
      "La requête a été rejetée en amont (400). La configuration du modèle ou du protocole est peut-être incompatible. Veuillez vérifier le nom du modèle, les paramètres du protocole et le point de terminaison de l'API.\nErreur d'origine : {{error}}",
    errAuthFailed:
      "Échec de l'authentification. Veuillez vérifier si l'API Key est correcte, si elle a expiré ou si elle n'a pas accès au modèle actuel.\nErreur d'origine : {{error}}",
    errRateLimited:
      "La requête a été limitée en débit (429). Le modèle ou le point de terminaison de l'API actuels ont atteint leur limite de fréquence d'appels. Veuillez réessayer plus tard.\nErreur d'origine : {{error}}",
    errUpstreamError:
      "Le service en amont a renvoyé une erreur — le service du modèle est peut-être surchargé ou temporairement indisponible. Le SDK réessaiera automatiquement.\nErreur d'origine : {{error}}",
    errNetworkInterrupted:
      'La connexion réseau a été interrompue ({{error}}). Le proxy ou la passerelle sont peut-être instables. Le SDK réessaiera automatiquement.',
    errCheckConfigHint: '_Veuillez vérifier votre configuration et réessayer._',
    errRetryingHint: "_L'agent réessaie automatiquement, veuillez patienter..._",
    errConfigRequired:
      "Le jeu de configuration actuel ne contient aucun identifiant utilisable. Veuillez d'abord finaliser la configuration dans les Paramètres de l'API.",
    noticeCompactionStart: 'Compaction du contexte de la conversation en cours...',
    noticeCompactionFailed: 'Échec de la compaction du contexte : {{error}}',
    noticeCompactionCompleted: 'Compaction du contexte terminée. Poursuite de la requête.',
    noticeHandoffStart: 'Résumé de la conversation en cours pour une nouvelle session…',
    noticeHandoffFailed: 'Échec de la reprise de session : {{error}}',
    startupFailedTitle: "Échec du démarrage d'Open Cowork",
    startupFailedBody: '{{message}}\n\nVeuillez consulter les journaux pour plus d’informations.',
    configDefaultSetName: 'Par défaut',
    configFallbackSetName: 'Configuration {{index}}',
  },
  de: {
    errModelTimeout:
      'Zeitüberschreitung bei der Modellantwort: Der vorgelagerte Dienst hat längere Zeit nicht reagiert. Bitte versuchen Sie es später erneut oder prüfen Sie die aktuelle Auslastung von Modell/Gateway.',
    errEmptySuccess:
      'Das Modell hat ein leeres, aber erfolgreiches Ergebnis zurückgegeben. Möglicherweise besteht ein Kompatibilitätsproblem mit dem aktuellen Modell oder Gateway – bitte versuchen Sie es erneut oder wechseln Sie das Protokoll.',
    errContextOverflow:
      'Der Gesprächskontext ist voll. Starten Sie eine neue Unterhaltung, kürzen Sie Nachrichten oder verringern Sie die maximalen Ausgabe-Tokens in den API-Einstellungen. (Limit: {{limit}} Tokens, genutzt: {{input}} input + {{output}} output)',
    errBadRequest:
      'Die Anfrage wurde vorgelagert abgelehnt (400). Die Konfiguration von Modell/Protokoll ist möglicherweise inkompatibel. Bitte prüfen Sie Modellname, Protokolleinstellungen und API-Endpunkt.\nUrsprünglicher Fehler: {{error}}',
    errAuthFailed:
      'Authentifizierung fehlgeschlagen. Bitte prüfen Sie, ob der API Key korrekt ist, abgelaufen ist oder keinen Zugriff auf das aktuelle Modell hat.\nUrsprünglicher Fehler: {{error}}',
    errRateLimited:
      'Die Anfrage wurde wegen einer Ratenbegrenzung abgelehnt (429). Das aktuelle Modell oder der API-Endpunkt hat sein Aufruflimit erreicht. Bitte versuchen Sie es später erneut.\nUrsprünglicher Fehler: {{error}}',
    errUpstreamError:
      'Der vorgelagerte Dienst hat einen Fehler zurückgegeben – der Modelldienst ist möglicherweise überlastet oder vorübergehend nicht verfügbar. Das SDK wiederholt den Vorgang automatisch.\nUrsprünglicher Fehler: {{error}}',
    errNetworkInterrupted:
      'Die Netzwerkverbindung wurde unterbrochen ({{error}}). Möglicherweise ist der Proxy bzw. das Gateway instabil. Das SDK wiederholt den Vorgang automatisch.',
    errCheckConfigHint: '_Bitte überprüfen Sie Ihre Konfiguration und versuchen Sie es erneut._',
    errRetryingHint: '_Der Agent wiederholt den Vorgang automatisch, bitte warten ..._',
    errConfigRequired:
      'Der aktuelle Konfigurationssatz enthält keine verwendbaren Anmeldedaten. Bitte schließen Sie zunächst die Einrichtung in den API-Einstellungen ab.',
    noticeCompactionStart: 'Gesprächskontext wird komprimiert, um Speicher freizugeben...',
    noticeCompactionFailed: 'Kontextkomprimierung fehlgeschlagen: {{error}}',
    noticeCompactionCompleted: 'Kontextkomprimierung abgeschlossen. Anfrage wird fortgesetzt.',
    noticeHandoffStart: 'Diese Unterhaltung wird für eine neue Sitzung zusammengefasst…',
    noticeHandoffFailed: 'Sitzungsübergabe fehlgeschlagen: {{error}}',
    startupFailedTitle: 'Open Cowork konnte nicht gestartet werden',
    startupFailedBody: '{{message}}\n\nWeitere Informationen finden Sie in den Protokollen.',
    configDefaultSetName: 'Standard',
    configFallbackSetName: 'Konfiguration {{index}}',
  },
  it: {
    errModelTimeout:
      "Risposta del modello scaduta: nessuna risposta dal servizio upstream da un po'. Riprova più tardi o controlla il carico attuale del modello/gateway.",
    errEmptySuccess:
      'Il modello ha restituito un risultato vuoto pur con esito positivo. Il modello o il gateway attuale potrebbe avere un problema di compatibilità: riprova oppure cambia protocollo e riprova.',
    errContextOverflow:
      'Il contesto della conversazione è pieno. Avvia una nuova conversazione, accorcia i messaggi o riduci i token di output massimi nelle Impostazioni API. (Limite: {{limit}} token, usati: {{input}} input + {{output}} output)',
    errBadRequest:
      "La richiesta è stata rifiutata dall'upstream (400). La configurazione del modello/protocollo potrebbe essere incompatibile. Controlla il nome del modello, le impostazioni del protocollo e l'endpoint API.\nErrore originale: {{error}}",
    errAuthFailed:
      "Autenticazione non riuscita. Controlla se l'API Key è corretta, è scaduta o non ha accesso al modello attuale.\nErrore originale: {{error}}",
    errRateLimited:
      "La richiesta è stata sottoposta a limitazione della frequenza (429). Il modello o l'endpoint API attuale ha raggiunto il limite di frequenza delle chiamate. Riprova più tardi.\nErrore originale: {{error}}",
    errUpstreamError:
      "Il servizio upstream ha restituito un errore: il servizio del modello potrebbe essere sovraccarico o temporaneamente non disponibile. L'SDK riproverà automaticamente.\nErrore originale: {{error}}",
    errNetworkInterrupted:
      'La connessione di rete si è interrotta ({{error}}). Il proxy/gateway potrebbe essere instabile. L’SDK riproverà automaticamente.',
    errCheckConfigHint: '_Controlla la configurazione e riprova._',
    errRetryingHint: "_L'agente sta riprovando automaticamente, attendi..._",
    errConfigRequired:
      'Il set di configurazione attuale non ha credenziali utilizzabili. Completa prima la configurazione in Impostazioni API.',
    noticeCompactionStart: 'Compressione del contesto della conversazione in corso...',
    noticeCompactionFailed: 'Compressione del contesto non riuscita: {{error}}',
    noticeCompactionCompleted:
      'Compressione del contesto completata. Continuazione della richiesta.',
    noticeHandoffStart: 'Riassunto della conversazione per una nuova sessione in corso…',
    noticeHandoffFailed: 'Passaggio di sessione non riuscito: {{error}}',
    startupFailedTitle: 'Avvio di Open Cowork non riuscito',
    startupFailedBody: '{{message}}\n\nControlla i log per maggiori informazioni.',
    configDefaultSetName: 'Predefinito',
    configFallbackSetName: 'Configurazione {{index}}',
  },
  uk: {
    errModelTimeout:
      'Час очікування відповіді моделі вичерпано: вихідний сервіс деякий час не надсилав відповіді. Повторіть спробу пізніше або перевірте поточне навантаження на модель чи шлюз.',
    errEmptySuccess:
      'Модель повернула порожній успішний результат. Можливо, поточна модель або шлюз має проблему сумісності — повторіть спробу або змініть протокол і спробуйте знову.',
    errContextOverflow:
      'Контекст розмови заповнено. Почніть нову розмову, скоротьте повідомлення або зменшіть максимальні вихідні токени в налаштуваннях API. (Ліміт: {{limit}} tokens, використано: {{input}} input + {{output}} output)',
    errBadRequest:
      'Запит відхилено на вихідному сервісі (400). Можливо, конфігурація моделі чи протоколу несумісна. Перевірте назву моделі, налаштування протоколу та точку доступу API.\nПервинна помилка: {{error}}',
    errAuthFailed:
      'Помилка автентифікації. Перевірте, чи правильний API Key, чи не сплив його строк дії та чи має він доступ до поточної моделі.\nПервинна помилка: {{error}}',
    errRateLimited:
      'Запит обмежено за частотою (429). Поточна модель або точка доступу API досягла ліміту частоти викликів. Повторіть спробу пізніше.\nПервинна помилка: {{error}}',
    errUpstreamError:
      'Вихідний сервіс повернув помилку — можливо, сервіс моделі перевантажений або тимчасово недоступний. SDK повторить спробу автоматично.\nПервинна помилка: {{error}}',
    errNetworkInterrupted:
      "Мережеве з'єднання було перервано ({{error}}). Можливо, проксі чи шлюз працює нестабільно. SDK повторить спробу автоматично.",
    errCheckConfigHint: '_Перевірте конфігурацію та повторіть спробу._',
    errRetryingHint: '_Агент повторює спробу автоматично, зачекайте..._',
    errConfigRequired:
      'Поточний набір конфігурації не має придатних облікових даних. Спершу завершіть налаштування в розділі параметрів API.',
    noticeCompactionStart: 'Стискаємо контекст розмови, щоб звільнити місце...',
    noticeCompactionFailed: 'Не вдалося стиснути контекст: {{error}}',
    noticeCompactionCompleted: 'Стиснення контексту завершено. Продовжуємо запит.',
    noticeHandoffStart: 'Підсумовуємо цю розмову для нової сесії…',
    noticeHandoffFailed: 'Не вдалося передати сесію: {{error}}',
    startupFailedTitle: 'Не вдалося запустити Open Cowork',
    startupFailedBody: '{{message}}\n\nПерегляньте журнали для отримання додаткової інформації.',
    configDefaultSetName: 'За замовчуванням',
    configFallbackSetName: 'Конфігурація {{index}}',
  },
  pl: {
    errModelTimeout:
      'Przekroczono limit czasu odpowiedzi modelu: usługa nadrzędna od pewnego czasu nie odpowiada. Spróbuj ponownie później lub sprawdź bieżące obciążenie modelu/bramy.',
    errEmptySuccess:
      'Model zwrócił pusty wynik mimo powodzenia. Bieżący model lub brama mogą mieć problem ze zgodnością — spróbuj ponownie albo zmień protokół i spróbuj jeszcze raz.',
    errContextOverflow:
      'Kontekst rozmowy jest pełny. Rozpocznij nową rozmowę, skróć wiadomości lub zmniejsz maksymalną liczbę tokenów wyjściowych w ustawieniach API. (Limit: {{limit}} tokenów, użyto: {{input}} input + {{output}} output)',
    errBadRequest:
      'Żądanie zostało odrzucone po stronie usługi nadrzędnej (400). Konfiguracja modelu/protokołu może być niezgodna. Sprawdź nazwę modelu, ustawienia protokołu oraz punkt końcowy API.\nBłąd źródłowy: {{error}}',
    errAuthFailed:
      'Uwierzytelnianie nie powiodło się. Sprawdź, czy API Key jest poprawny, nie wygasł oraz czy ma dostęp do bieżącego modelu.\nBłąd źródłowy: {{error}}',
    errRateLimited:
      'Żądanie zostało ograniczone przez limit szybkości (429). Bieżący model lub punkt końcowy API osiągnął limit liczby wywołań. Spróbuj ponownie później.\nBłąd źródłowy: {{error}}',
    errUpstreamError:
      'Usługa nadrzędna zwróciła błąd — usługa modelu może być przeciążona lub chwilowo niedostępna. SDK ponowi próbę automatycznie.\nBłąd źródłowy: {{error}}',
    errNetworkInterrupted:
      'Połączenie sieciowe zostało przerwane ({{error}}). Serwer proxy/brama mogą być niestabilne. SDK ponowi próbę automatycznie.',
    errCheckConfigHint: '_Sprawdź konfigurację i spróbuj ponownie._',
    errRetryingHint: '_Agent automatycznie ponawia próbę, proszę czekać..._',
    errConfigRequired:
      'Bieżący zestaw konfiguracji nie zawiera użytecznych poświadczeń. Najpierw dokończ konfigurację w ustawieniach API.',
    noticeCompactionStart: 'Kompresowanie kontekstu rozmowy w celu zwolnienia miejsca...',
    noticeCompactionFailed: 'Kompresja kontekstu nie powiodła się: {{error}}',
    noticeCompactionCompleted: 'Kompresja kontekstu zakończona. Kontynuowanie żądania.',
    noticeHandoffStart: 'Podsumowywanie rozmowy dla nowej sesji…',
    noticeHandoffFailed: 'Przekazanie sesji nie powiodło się: {{error}}',
    startupFailedTitle: 'Nie udało się uruchomić Open Cowork',
    startupFailedBody: '{{message}}\n\nSprawdź dzienniki, aby uzyskać więcej informacji.',
    configDefaultSetName: 'Domyślny',
    configFallbackSetName: 'Konfiguracja {{index}}',
  },
  sv: {
    errModelTimeout:
      'Modellsvaret tog för lång tid: inget svar från uppströmstjänsten på ett tag. Försök igen senare eller kontrollera den aktuella belastningen på modellen/gatewayen.',
    errEmptySuccess:
      'Modellen returnerade ett tomt lyckat resultat. Den aktuella modellen eller gatewayen kan ha ett kompatibilitetsproblem – försök igen eller byt protokoll och försök på nytt.',
    errContextOverflow:
      'Konversationskontexten är full. Starta en ny konversation, förkorta meddelanden eller sänk max antal utdatatokens i API-inställningarna. (Gräns: {{limit}} tokens, använt: {{input}} input + {{output}} output)',
    errBadRequest:
      'Begäran avvisades uppströms (400). Konfigurationen för modellen/protokollet kan vara inkompatibel. Kontrollera modellnamnet, protokollinställningarna och API-slutpunkten.\nUrsprungligt fel: {{error}}',
    errAuthFailed:
      'Autentiseringen misslyckades. Kontrollera om din API Key är korrekt, har upphört att gälla eller saknar åtkomst till den aktuella modellen.\nUrsprungligt fel: {{error}}',
    errRateLimited:
      'Begäran hastighetsbegränsades (429). Den aktuella modellen eller API-slutpunkten har nått sin gräns för anropsfrekvens. Försök igen senare.\nUrsprungligt fel: {{error}}',
    errUpstreamError:
      'Uppströmstjänsten returnerade ett fel – modelltjänsten kan vara överbelastad eller tillfälligt otillgänglig. SDK gör automatiskt ett nytt försök.\nUrsprungligt fel: {{error}}',
    errNetworkInterrupted:
      'Nätverksanslutningen avbröts ({{error}}). Proxyn/gatewayen kan vara instabil. SDK gör automatiskt ett nytt försök.',
    errCheckConfigHint: '_Kontrollera din konfiguration och försök igen._',
    errRetryingHint: '_Agenten försöker igen automatiskt, vänta..._',
    errConfigRequired:
      'Den aktuella konfigurationsuppsättningen saknar användbara autentiseringsuppgifter. Slutför först konfigurationen i API-inställningarna.',
    noticeCompactionStart: 'Komprimerar konversationskontexten för att frigöra utrymme...',
    noticeCompactionFailed: 'Kontextkomprimering misslyckades: {{error}}',
    noticeCompactionCompleted: 'Kontextkomprimering slutförd. Fortsätter begäran.',
    noticeHandoffStart: 'Sammanfattar den här konversationen för en ny session…',
    noticeHandoffFailed: 'Sessionsöverlämning misslyckades: {{error}}',
    startupFailedTitle: 'Open Cowork kunde inte starta',
    startupFailedBody: '{{message}}\n\nKontrollera loggarna för mer information.',
    configDefaultSetName: 'Standard',
    configFallbackSetName: 'Konfiguration {{index}}',
  },
  no: {
    errModelTimeout:
      'Tidsavbrudd for modellsvaret: ingen respons fra den underliggende tjenesten på en stund. Prøv igjen senere, eller sjekk gjeldende belastning på modellen/gatewayen.',
    errEmptySuccess:
      'Modellen returnerte et tomt, vellykket resultat. Gjeldende modell eller gateway kan ha et kompatibilitetsproblem – prøv igjen, eller bytt protokoll og prøv på nytt.',
    errContextOverflow:
      'Samtalekonteksten er full. Start en ny samtale, forkort meldingene eller senk maks antall utdatatokens i API-innstillingene. (Grense: {{limit}} tokens, brukt: {{input}} input + {{output}} output)',
    errBadRequest:
      'Forespørselen ble avvist av den underliggende tjenesten (400). Modell-/protokollkonfigurasjonen kan være inkompatibel. Sjekk modellnavnet, protokollinnstillingene og API-endepunktet.\nOpprinnelig feil: {{error}}',
    errAuthFailed:
      'Autentiseringen mislyktes. Sjekk om API Key er riktig, har utløpt, eller mangler tilgang til gjeldende modell.\nOpprinnelig feil: {{error}}',
    errRateLimited:
      'Forespørselen ble begrenset på grunn av for høy frekvens (429). Gjeldende modell eller API-endepunkt har nådd grensen for antall kall. Prøv igjen senere.\nOpprinnelig feil: {{error}}',
    errUpstreamError:
      'Den underliggende tjenesten returnerte en feil – modelltjenesten kan være overbelastet eller midlertidig utilgjengelig. SDK prøver automatisk på nytt.\nOpprinnelig feil: {{error}}',
    errNetworkInterrupted:
      'Nettverkstilkoblingen ble avbrutt ({{error}}). Proxyen/gatewayen kan være ustabil. SDK prøver automatisk på nytt.',
    errCheckConfigHint: '_Sjekk konfigurasjonen og prøv igjen._',
    errRetryingHint: '_Agenten prøver automatisk på nytt, vent litt …_',
    errConfigRequired:
      'Gjeldende konfigurasjonssett har ingen brukbare legitimasjoner. Fullfør oppsettet i API-innstillinger først.',
    noticeCompactionStart: 'Komprimerer samtalekonteksten for å frigjøre plass...',
    noticeCompactionFailed: 'Kontekstkomprimering mislyktes: {{error}}',
    noticeCompactionCompleted: 'Kontekstkomprimering fullført. Fortsetter forespørselen.',
    noticeHandoffStart: 'Oppsummerer denne samtalen for en ny økt…',
    noticeHandoffFailed: 'Øktoverlevering mislyktes: {{error}}',
    startupFailedTitle: 'Open Cowork kunne ikke starte',
    startupFailedBody: '{{message}}\n\nSjekk loggene for mer informasjon.',
    configDefaultSetName: 'Standard',
    configFallbackSetName: 'Konfigurasjon {{index}}',
  },
  nl: {
    errModelTimeout:
      'Time-out bij modelantwoord: het upstream-service reageerde een tijd lang niet. Probeer het later opnieuw of controleer de huidige belasting van het model/de gateway.',
    errEmptySuccess:
      'Het model gaf een leeg succesvol resultaat terug. Mogelijk is er een compatibiliteitsprobleem met het huidige model of de gateway — probeer het opnieuw of schakel over op een ander protocol en probeer het nogmaals.',
    errContextOverflow:
      'De gesprekscontext is vol. Start een nieuw gesprek, verkort berichten of verlaag het maximum aantal outputtokens in de API-instellingen. (Limiet: {{limit}} tokens, gebruikt: {{input}} input + {{output}} output)',
    errBadRequest:
      'De aanvraag werd upstream geweigerd (400). Mogelijk is de model-/protocolconfiguratie niet compatibel. Controleer de modelnaam, de protocolinstellingen en het API-eindpunt.\nOorspronkelijke fout: {{error}}',
    errAuthFailed:
      'Verificatie mislukt. Controleer of de API Key juist is, niet verlopen is en toegang heeft tot het huidige model.\nOorspronkelijke fout: {{error}}',
    errRateLimited:
      'De aanvraag is gelimiteerd (429). Het huidige model of API-eindpunt heeft zijn limiet voor het aantal aanroepen bereikt. Probeer het later opnieuw.\nOorspronkelijke fout: {{error}}',
    errUpstreamError:
      'Het upstream-service gaf een fout terug — de modelservice is mogelijk overbelast of tijdelijk niet beschikbaar. De SDK probeert het automatisch opnieuw.\nOorspronkelijke fout: {{error}}',
    errNetworkInterrupted:
      'De netwerkverbinding werd onderbroken ({{error}}). De proxy/gateway is mogelijk instabiel. De SDK probeert het automatisch opnieuw.',
    errCheckConfigHint: '_Controleer je configuratie en probeer het opnieuw._',
    errRetryingHint: '_De agent probeert het automatisch opnieuw, even geduld..._',
    errConfigRequired:
      'De huidige configuratieset bevat geen bruikbare inloggegevens. Voltooi eerst de installatie in de API-instellingen.',
    noticeCompactionStart: 'Gesprekscontext wordt gecomprimeerd om ruimte vrij te maken...',
    noticeCompactionFailed: 'Contextcompressie mislukt: {{error}}',
    noticeCompactionCompleted: 'Contextcompressie voltooid. Verzoek wordt voortgezet.',
    noticeHandoffStart: 'Dit gesprek wordt samengevat voor een nieuwe sessie…',
    noticeHandoffFailed: 'Sessieoverdracht mislukt: {{error}}',
    startupFailedTitle: 'Open Cowork kon niet worden gestart',
    startupFailedBody: '{{message}}\n\nRaadpleeg de logbestanden voor meer informatie.',
    configDefaultSetName: 'Standaard',
    configFallbackSetName: 'Configuratie {{index}}',
  },
  ro: {
    errModelTimeout:
      'Răspunsul modelului a expirat: niciun răspuns de la serviciul din amonte pentru o vreme. Reîncearcă mai târziu sau verifică gradul de încărcare al modelului/gateway-ului.',
    errEmptySuccess:
      'Modelul a returnat un rezultat reușit, dar gol. Este posibil ca modelul sau gateway-ul curent să aibă o problemă de compatibilitate — reîncearcă sau schimbă protocolul și încearcă din nou.',
    errContextOverflow:
      'Contextul conversației este plin. Începe o conversație nouă, scurtează mesajele sau reduce tokenii maximi de ieșire din Setări API. (Limită: {{limit}} tokeni, folosit: {{input}} input + {{output}} output)',
    errBadRequest:
      'Cererea a fost respinsă în amonte (400). Configurația modelului/protocolului poate fi incompatibilă. Verifică numele modelului, setările de protocol și punctul de acces API.\nEroare originală: {{error}}',
    errAuthFailed:
      'Autentificarea a eșuat. Verifică dacă API Key este corectă, a expirat sau nu are acces la modelul curent.\nEroare originală: {{error}}',
    errRateLimited:
      'Cererea a fost limitată ca rată (429). Modelul sau punctul de acces API curent a atins limita de rată a apelurilor. Reîncearcă mai târziu.\nEroare originală: {{error}}',
    errUpstreamError:
      'Serviciul din amonte a returnat o eroare — este posibil ca serviciul modelului să fie suprasolicitat sau temporar indisponibil. SDK va reîncerca automat.\nEroare originală: {{error}}',
    errNetworkInterrupted:
      'Conexiunea la rețea a fost întreruptă ({{error}}). Este posibil ca proxy-ul/gateway-ul să fie instabil. SDK va reîncerca automat.',
    errCheckConfigHint: '_Verifică configurația și reîncearcă._',
    errRetryingHint: '_Agentul reîncearcă automat, te rugăm să aștepți..._',
    errConfigRequired:
      'Setul de configurație curent nu are credențiale utilizabile. Finalizează mai întâi configurarea în Setări API.',
    noticeCompactionStart: 'Se compactează contextul conversației pentru a elibera spațiu...',
    noticeCompactionFailed: 'Compactarea contextului a eșuat: {{error}}',
    noticeCompactionCompleted: 'Compactarea contextului s-a încheiat. Se continuă cererea.',
    noticeHandoffStart: 'Se rezumă această conversație pentru o sesiune nouă…',
    noticeHandoffFailed: 'Transferul sesiunii a eșuat: {{error}}',
    startupFailedTitle: 'Open Cowork nu a putut porni',
    startupFailedBody: '{{message}}\n\nVerifică jurnalele pentru mai multe informații.',
    configDefaultSetName: 'Implicit',
    configFallbackSetName: 'Configurația {{index}}',
  },
};
