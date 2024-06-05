require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const { Vonage } = require("@vonage/server-sdk");
const textToSpeeches = require("@google-cloud/text-to-speech");
const speech = require("@google-cloud/speech");

const openai = require("openai");

const app = express();

const clientTTS = new textToSpeeches.TextToSpeechClient();
const clientSTT = new speech.SpeechClient();

const PORT = process.env.PORT || 5000;
const VONAGE_NUMBER = process.env.VONAGE_NUMBER;
const ANSWER_URL = process.env.ANSWER_WEBHOOK_URL;
const EVENT_URL = process.env.WEBHOOK_URL;

const vonage = new Vonage(
  {
    apiKey: process.env.VONAGE_API_KEY,
    apiSecret: process.env.VONAGE_API_SECRET,
    applicationId: process.env.VONAGE_APPLICATION_ID,
    privateKey: process.env.VONAGE_PRIVATE_KEY_PATH,
  },
  { debug: true }
);

const expressWs = require("express-ws")(app);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());

async function getGPT4Response(prompt) {
  const completion = await openai.createCompletion({
    model: "text-davinci-004",
    prompt: prompt,
  });
  return completion.data.choices[0].text;
}

async function textToSpeech(text) {
  const [response] = await clientTTS.synthesizeSpeech({
    input: { text: text },
    voice: { languageCode: "en-US", ssmlGender: "NEUTRAL" },
    audioConfig: { audioEncoding: "MP3" },
  });
  return response.audioContent;
}

async function speechToText(audioContent) {
  const [response] = await clientSTT.recognize({
    audio: { content: audioContent.toString("base64") },
    config: {
      encoding: "LINEAR16",
      sampleRateHertz: 16000,
      languageCode: "en-US",
    },
  });
  return response.results
    .map((result) => result.alternatives[0].transcript)
    .join("\n");
}

// make a call
app.post("/call", async (req, res) => {
  let call_details = "";
  try {
    call_details = await vonage.voice.createOutboundCall(
      {
        to: [{ type: "phone", number: req.body.phoneNumber }],
        from: { type: "phone", number: VONAGE_NUMBER },
        answer_url: [ANSWER_URL],
        event_url: [EVENT_URL],
      },
      (err, response) => {
        if (err) {
          console.error("Error making outbound call:", err);
        } else {
          console.log("Outbound call response:", response);
        }
      }
    );
  } catch (error) {
    console.log(error);
  }
  return res
    .status(200)
    .json({ call: call_details, message: "call_instantiated" });
});

// End the call
app.post("/end-call", async (req, res) => {});
app.get("/", (req, res) => {
  res.status(200).json({ message: "OK" });
});

// get call status
app.get("/call-status", async (req, res) => {
  var call_uuid = req.query.id;
  const response = await vonage.voice
    .getCall(call_uuid)
    .then((resp) => {
      return res.status(200).json({ response: resp, status: 200 });
    })
    .catch((err) => {
      return res.status(201).json({ response: err, status: 201 });
    });
});

app
  .get("/answer", (req, res) => {
    //Serve the NCCO on the /ncco answer URL // answer event
    let nccoResponse = [
      {
        action: "stream",
        streamUrl: ["http://914288e7.ngrok.io/audio/silence.mp3"],
      },
      {
        action: "connect",
        from: "NexmoTest",
        endpoint: [
          {
            type: "websocket",
            uri: `wss://${req.hostname}/socket`,
            "content-type": "audio/l16;rate=16000",
          },
        ],
      },
    ];
    res.status(200).json(nccoResponse);
  })
  .ws("/socket", (ws, req) => {
    ws.on("message", async function (message) {
      // const transcript = await speechToText(Buffer.from(message));
      // const response = await getGPT4Response(transcript);
      // const audioContent = await textToSpeech(response);
      ws.send(message);
    });

    ws.on("close", function () {
      console.log("Websocket ended successfully");
    });
  });

//Log the Events
app.post("/event", function (req, res) {
  let status = req.body.status;
  let conversation_uuid = req.body.conversation_uuid;
  switch (status) {
    case "ringing":
      record_event_logs({ UUID: conversation_uuid, status: "ringing" });
      break;
    case "answered":
      record_event_logs({ UUID: conversation_uuid, status: "answered" });
      break;
    case "complete":
      record_event_logs({ UUID: conversation_uuid, status: "complete" });
      break;
    case "canceled":
      record_event_logs({ UUID: conversation_uuid, status: "canceled" });
      break;
    default:
      break;
  }
  return res.status(204).send({ message: "Status is changing" });
});

// websocket connection
expressWs.getWss().on("connection", function (ws) {
  console.log("Websocket connection is open");
});

app.listen(PORT, () =>
  console.log(`Listening on port http://localhost:${PORT}`)
);
