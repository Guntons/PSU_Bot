const webSocketURL = "ws://127.0.0.1:8000/ws";

/**
 * gets random element of array
 *
 * @param {*} arr array to choose from
 * @return {*} random element of array
 */
function randomChoice(arr) {
    return arr[Math.floor(arr.length * Math.random())];
}

// map of characters to escape
const entityMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '/': '&#x2F;',
    '`': '&#x60;',
    '=': '&#x3D;'
};

/**
 * escapes characters from entityMap which can be dangerous
 * @param {*} string string to escape
 * @returns string with replaced characters
 */
function escapeHtml(string) {
    return String(string).replace(/[&<>"'`=\/]/g, function (s) {
        return entityMap[s];
    });
}

/**
 * shows the tabcontent which the tablink targets
 *
 * tablink must have 'target' attribute with id of the tabcontent it activates
 * @param {*} event
 */
function showTab(event) {
    // hide all tabs
    const tabcontents = document.getElementsByClassName("tabcontent");
    for (let element of tabcontents) {
        element.setAttribute("hidden", "");
    }
    // make all links inactive
    const tablinks = document.getElementsByClassName("tablinks");
    for (let element of tablinks) {
        element.classList.remove("active");
    }
    // show target tab and activate button
    const targetId = event.currentTarget.getAttribute("target");
    document.getElementById(targetId).removeAttribute("hidden");
    event.currentTarget.classList.add("active");
}

/**
 * binds tablinks click handlers to showTab
 */
function bindTablinksClicks() {
    const tablinks = document.getElementsByClassName("tablinks");
    for (const element of tablinks) {
        element.addEventListener('click', showTab);
    }
}

/**
 * gets new message element
 * @param {*} prototypeId id of the element used as prototype to create new message
 * @param {*} innerHTML html of the message
 * @param {*} sanitize if true innerHTML will be sanitized. Defaults to true
 * @returns message element
 */
function getNewMessage(prototypeId, innerHTML, sanitize = true) {
    // creates a new element from a prototype element with message as its innerHTML
    const message = document.getElementById(prototypeId).cloneNode(true);
    message.removeAttribute("hidden");
    message.innerHTML = sanitize ? escapeHtml(innerHTML) : innerHTML;
    return message;
}

/**
 * adds the message element to the messages window and scrolls to bottom
 * @param {*} innerHTML message to add
 */
function showMessage(innerHTML) {
    messagesWindow = document.getElementById('messagesWindow');
    messagesWindow.appendChild(innerHTML);
    messagesWindow.scrollTop = messagesWindow.scrollHeight;
}

/**
 * creates and shows new message
 * @param {*} prototypeId id of the element used as prototype to create new message
 * @param {*} innerHTML html of the message
 * @param {*} sanitize if true innerHTML will be sanitized. Defaults to true
 */
function createMessage(prototypeId, innerHTML, sanitize = true) {
    showMessage(getNewMessage(prototypeId, innerHTML, sanitize));
}

/**
 * @classdesc Base class for requests
 */
class Request {
    /**
     * converts request to json with request type
     * @returns dictionary of request values and type of request object
     */
    toJSON() {
        let dict = {...this};
        dict.type = this.constructor.name;
        return dict;
    }
}

// dict containing all responses
var responses = {};

/**
 * @classdesc Base class for responses
 */
class Response {
    /**
     * creates un-sanitized message from this response's getMessage
     */
    showMessage() {
        createMessage("botMessage", this.getMessage(), false);
    }

    /**
     * gets message interpretation of response, abstract
     * @returns message interpretation of response
     */
    getMessage() {
        throw new Error("getMessage is not implemented");
    }
}

class InputRequest extends Request {
    /**
     * request for getting questions by user input
     * @param {*} input user input
     */
    constructor(input) {
        super();
        this.input = input;
    }
}

responses.InputResponse = class InputResponse extends Response {
    /**
     * response to InputRequest
     * @param {*} questions list of questions fitting InputRequest
     */
    constructor(questions) {
        super();
        this.questions = questions;
    }

    getMessage() {
        if (this.questions.length === 0) {
            return "Я не смогла ничего найти по запросу";
        }

        let message = "Вот что я нашла по запросу: <br>";
        for (let question of this.questions) {
            message += `<a href="#" onclick="onQuestionClick(this)">${question}</a><br>`;
        }
        return message;
    }
}

class QuestionRequest extends Request {
    /**
     * request for answer to question
     * @param {*} question question to get answer for
     */
    constructor(question) {
        super();
        this.question = question;
    }
}

responses.QuestionResponse = class QuestionResponse extends Response {
    /**
     * response to QuestionRequest
     * @param {*} answer answer to question
     * @param {*} pictures list of links to pictures related to answer
     */
    constructor(question, answer, pictures) {
        super();
        this.question = question;
        this.answer = answer;
        this.pictures = pictures;
    }

    /**
     * shows random message that invites user to ask another question
     */
    #showInvitation() {
        createMessage(
            "botMessage",
            randomChoice([
                "У тебя остались ещё вопросы?",
                "Может у тебя есть ещё вопросы?",
                "Если у тебя остались вопросы, можешь мне их задать."
            ])
        );
    }

    showMessage() {
        super.showMessage();
        this.#showInvitation();
    }

    getMessage() {
        let message = `Вот что я знаю по вопросу "${this.question}":<br>${this.answer}`;
        for (const pic of this.pictures) {
            message += `<br><img src="${pic}" class="img-fluid"></img>`;
        }
        return message;
    }
}

/**
 * gets Response object of correct type and fills it with data
 * @param {*} data data to fill response with
 * @returns response object
 */
function getResponseObject(data) {
    const type = responses[data.type];
    delete data.type;
    let response = new type;
    for (let [key, value] of Object.entries(data)) {
        response[key] = value;
    }
    return response;
}

// websocket connection
const socket = new WebSocket(webSocketURL);

/**
 * returns random dialog string from responses if input in respondedWords
 * @param {*} input user input
 * @param {*} responsesPairs array of arrays where each element is [respondedWords (words to which to response), responses (response variants)]
 * @returns random response if found input in respondedWords, null otherwise
 */
function getDialogResponse(input, responsesPairs) {
    input = input.trim().toLowerCase();
    for (const [respondedWords, responses] of responsesPairs) {
        if (respondedWords.includes(input)) {
            return randomChoice(responses);
        }
    }
    return null;
}

const dialogResponses = [
    [
        // thanks response
        ["спасибо", "спс", "пасиб"],
        [
            "Я рада, что помогла тебе",
            "Надеюсь, я тебе помогла",
            "Обращайтесь, если возникнут вопросы"
        ]
    ],
    [
        // greeting response
        ["здравствуй", "здравствуйте", "здорова", "привет", "прив"],
        [
            "Здравствуй, чем я могу помочь?",
            "Привет, чем тебе помочь?",
            "Здравствуй, что мне для тебя найти?"
        ]
    ],
    [
        // goodbye response
        ["пока", "до свидания"],
        [
            "До свидания, буду ждать вас снова"
        ]
    ]
];

/**
 * when send button is clicked
 */
async function onSendButtonClick() {
    const inputElement = document.getElementById('messageInput');
    const inputValue = inputElement.value;
    if (inputValue.length === 0)
        return;
    inputElement.value = "";
    createMessage('userMessage', inputValue);

    let dialogResponse = getDialogResponse(inputValue, dialogResponses);
    if (dialogResponse !== null) {
        createMessage("botMessage", dialogResponse);
        return;
    }

    const input = new InputRequest(inputValue);
    socket.send(JSON.stringify(input));
}

/**
 * when question link is clicked
 * @param {*} target element from which event is fired
 */
async function onQuestionClick(target) {
    const question = new QuestionRequest(target.innerHTML);
    socket.send(JSON.stringify(question));
}

/**
 * when ws message is received
 * @param {*} event
 */
async function onMessageReceived(event) {
    const data = JSON.parse(event.data);
    const response = getResponseObject(data);
    response.showMessage();
}

/**
 * shows random greeting message when user opens the page
 */
function showGreeting() {
    createMessage(
        "botMessage",
        randomChoice([
            "Привет! Я Василиса, готова ответить на ваши вопросы.",
            "Привет, я Василиса. Если у вас появились вопросы, я готова на них ответить.",
            "Приветствую тебя, друг. Если у тебя появились вопросы, смело задавай их мне."
        ])
    );
}

/**
 * adds listeners to needed events
 */
function addListeners() {
    socket.addEventListener("message", onMessageReceived);

    addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            onSendButtonClick();
        }
    });

    bindTablinksClicks();
    document.getElementById("chatBotLink").click();
    document.getElementById('sendButton').addEventListener('click', onSendButtonClick);
}

/**
 * main function of script
 */
function main() {
    addListeners();
    showGreeting();
}

main();