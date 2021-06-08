import path from "path";
import dotenv from "dotenv";
import express, { response } from "express";
import bodyParser from "body-parser";
import axios from "axios";
import {
  Conference,
  ApiCreateCallRequest,
  ApiError,
  ApiController,
  Client,
  Response,
  SpeakSentence,
} from "@bandwidth/voice";
const bandwidthWebRTC = require("@bandwidth/webrtc");

dotenv.config();

const app = express();
app.use(bodyParser.json());
const port = process.env.PORT || 5000;
const accountId = <string>process.env.BW_ACCOUNT_ID;
const username = <string>process.env.BW_USERNAME;
const password = <string>process.env.BW_PASSWORD;
const voiceApplicationPhoneNumber = <string>process.env.BW_NUMBER; // the 'from' number
const voiceApplicationId = <string>process.env.BW_VOICE_APPLICATION_ID;
const voiceCallbackUrl = <string>process.env.BASE_CALLBACK_URL;

console.log(
  "call control url is...",
  process.env.BANDWIDTH_WEBRTC_CALL_CONTROL_URL
);
const callControlUrl = `${process.env.BANDWIDTH_WEBRTC_CALL_CONTROL_URL}/accounts/${accountId}`;

// Check to make sure required environment variables are set
if (!accountId || !username || !password) {
  console.error(
    "ERROR! Please set the BW_ACCOUNT_ID, BW_USERNAME, and BW_PASSWORD environment variables before running this app"
  );
  process.exit(1);
}

interface Participant {
  id: string;
  token: string;
}

interface CallData {
  from: string;
  to: string;
  bridge: boolean;
}

// TODO - general cleanup
// TODO - readme documentation update
// TODO - rework the front end a bit for cleanup
// TODO - clean out extra logs
// TODO - upgrade callAnswered to the current version of the voice SDK, just because

let webRTCController = bandwidthWebRTC.APIController;

const voiceClient = new Client({
  basicAuthUserName: username,
  basicAuthPassword: password,
});
const voiceController = new ApiController(voiceClient);

let sessionId: string;
let voiceCalls: Map<string, CallData> = new Map();
let bridgeParticipant: Participant;
let webParticipant: Participant;

process.on("SIGINT", async function () {
  if (bridgeParticipant) {
    await killSipUriLeg(bridgeParticipant);
    await deleteParticipant(bridgeParticipant.id);
  }
  if (webParticipant) await deleteParticipant(webParticipant.id);
  if (sessionId) await deleteSession();
  process.exit();
});

/////////////////////////////////////////////////////////////////////////////
//                                                                         //
// REST API Config                                                         //
//                                                                         //
// These endpoints handle requests from the browser to get connection      //
// info and requests from the Voice API to handle incoming phone calls     //
//                                                                         //
/////////////////////////////////////////////////////////////////////////////

/**
 * The browser will hit this endpoint to get a session and participant ID
 */
app.get("/connectionInfo", async (req, res) => {
  webParticipant = await createParticipant("hello-world-browser");
  res.send({
    token: webParticipant.token,
    voiceApplicationPhoneNumber: voiceApplicationPhoneNumber,
    outboundPhoneNumber: "user selected Telephone Numbers",
  });
  bridgeParticipant = await createParticipant("hello-world-phone");

  const createCallResponse = await callSipUri(bridgeParticipant);
  console.log(
    "bridge Call Result",
    createCallResponse?.status,
    createCallResponse?.data
  );
});

/**
 * The killConnection endpoint cleans up all resources, used as a callback
 * on the loss of media flow to the controlling Web Browser.
 */
app.post("/killConnection", async (req, res) => {
  res.send();
  console.log("in /killConnection", req.body);
  if (
    req.body.event === "onLeave" &&
    webParticipant &&
    req.body.participantId == webParticipant.id
  ) {
    // TODO - move the null check inside of the functions
    await killSipUriLeg(bridgeParticipant);
    await deleteParticipant(bridgeParticipant.id);
    await deleteParticipant(webParticipant.id);
    await deleteSession();
  }
});

/**
 * The browser will hit this endpoint to initiate a call to the outbound phone number
 */
app.post("/callPhone", async (req, res) => {
  console.log("calling a phone", req.body);

  const outboundPhoneNumber = req.body.calledTelephoneNumber;
  if (
    !outboundPhoneNumber ||
    !outboundPhoneNumber.match(/^\+1[2-9][0-9]{9}$/)
  ) {
    console.log("missing or incorrectly formatted telephone number");
    res
      .status(400)
      .send(
        `missing or incorrectly formatted telephone number${outboundPhoneNumber}`
      );
  }
  await callPhone(outboundPhoneNumber);
  res.status(204).send();
});

/**
 * the /bridgeCallAnswered api call completes the linkage of the webRTC and
 * V2 Voice environments
 */
app.post("/bridgeCallAnswered", async (req, res) => {
  console.log("Bridge call answered body", req.body);

  const callId = req.body.callId;

  // preserve the call-leg
  let data: CallData = {
    from: req.body.from,
    to: req.body.to,
    bridge: true,
  };

  voiceCalls.set(callId, data); // preserve the info on the bridge leg in the calls map.

  const conf = new Conference({
    name: sessionId,
    callIdsToCoach: undefined,
  });

  const resp = new Response(conf);
  console.log("creating conference bridge:", data, resp.toBxml());

  res.contentType("application/xml").send(resp.toBxml());
});

/**
 * Bandwidth's Voice API will hit this endpoint when an outgoing call is answered
 * the outboud call will be connected to a conference bridge
 */
app.post("/callAnswered", async (req, res) => {
  const callId = req.body.callId;
  console.log(
    `received answered callback for call ${callId} to ${req.body.to}`
  );

  // preserve the call-leg
  let data: CallData = {
    from: req.body.from,
    to: req.body.to,
    bridge: false,
  };

  voiceCalls.set(callId, data); // preserve the info on the bridge leg in the calls map.

  console.log("voiceCalls MAP: ", voiceCalls);

  // This is the response payload that we will send back to the Voice API to conference the call into the WebRTC session
  const bxml = `<?xml version="1.0" encoding="UTF-8" ?>
  <Response>
      <SpeakSentence voice="julie">Thank you. Connecting you to your conference now.</SpeakSentence>
      <Conference>${sessionId}</Conference>
  </Response>`;

  // Send the payload back to the Voice API
  res.contentType("application/xml").send(bxml);
  console.log(`conferencing outbound call using v2 voice ${callId}`);
});

/**
 * Bandwidth's Voice API will hit this endpoint with status updates for calls, typically for disconnects
 */
app.post("/callStatus", async (req, res) => {
  res.status(200).send();

  try {
    if (req.body.eventType === "disconnect") {
      // Do some cleanup
      const callId = req.body.callId;
      console.log(`received disconnect event for call ${callId}`);

      const callData = voiceCalls.get(callId);
      if (callData?.bridge) {
        // results from disconnecting the bridge - clean up
        deleteParticipant(bridgeParticipant.id);
      }
      voiceCalls.delete(callId);
    } else {
      console.log("received unexpected status update", req.body);
    }
  } catch (e) {
    console.log(`failed to cleanup departing participants...${e}`);
  }
});

// These two lines set up static file serving for the React frontend
app.use(express.static(path.join(__dirname, "..", "frontend", "build")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "build", "index.html"));
});
app.listen(port, () =>
  console.log(`WebRTC Hello World listening on port ${port}!`)
);

/////////////////////////////////////////////////////////////////////////////
//                                                                         //
// Bandwidth WebRTC Functions                                              //
//                                                                         //
// The following few functions make requests to the WebRTC Service to      //
// create sessions and participants.                                       //
//                                                                         //
/////////////////////////////////////////////////////////////////////////////

/**
 * Get a new or existing WebRTC session ID
 */
const getSessionId = async (): Promise<string> => {
  // If we already have a valid session going, just re-use that one
  if (sessionId) {
    try {
      await axios.get(`${callControlUrl}/sessions/${sessionId}`, {
        auth: {
          username: username,
          password: password,
        },
      });
      console.log(`using session ${sessionId}`);
      return sessionId;
    } catch (e) {
      console.log(`session ${sessionId} is invalid, creating a new session`);
    }
  }

  // Otherwise start a new one and return the ID
  let response = await axios.post(
    `${callControlUrl}/sessions`,
    {
      tag: "hello-world",
    },
    {
      auth: {
        username: username,
        password: password,
      },
    }
  );
  sessionId = response.data.id;
  console.log(`created new session ${sessionId}`);
  return sessionId;
};

/**
 * Create a new participant and save their ID to our app's state map
 */
const createParticipant = async (tag: string): Promise<Participant> => {
  // Create a new participant
  console.log(`creating a participant at ${callControlUrl}/participants`);
  let createParticipantResponse = await axios.post(
    `${callControlUrl}/participants`,
    {
      publishPermissions: ["AUDIO"],
      tag: tag,
      deviceApiVersion: "V3",
      callbackUrl: `${voiceCallbackUrl}/killConnection`,
    },
    {
      auth: {
        username: username,
        password: password,
      },
    }
  );

  const participant = createParticipantResponse.data.participant;
  const token = createParticipantResponse.data.token;
  const participantId = participant.id;
  console.log(`created new participant ${participantId}`);

  // Add participant to session
  const sessionId = await getSessionId();
  await axios.put(
    `${callControlUrl}/sessions/${sessionId}/participants/${participant.id}`,
    {
      sessionId: sessionId,
    },
    {
      auth: {
        username: username,
        password: password,
      },
    }
  );

  return {
    id: participantId,
    token: token,
  };
};

/**
 * Delete a session
 */
const deleteSession = async () => {
  if (sessionId) {
    try {
      let response = await axios.delete(
        `${callControlUrl}/sessions/${sessionId}`,
        {
          auth: {
            username: username,
            password: password,
          },
        }
      );
      console.log(
        `Deleted WebRTC session: ${sessionId} - response - ${response.status} - data -  ${response.data}`
      );
      sessionId = "";
    } catch (e) {
      console.log("failed to delete session", sessionId);
      console.log("error", e.response.status, e.response.data, e.config.url);
    }
  }
};

/**
 * Delete a participant
 */
const deleteParticipant = async (participantId: string) => {
  console.log(`deleting participant ${participantId}`);

  try {
    const resp = await axios.delete(
      `${callControlUrl}/participants/${participantId}`,
      {
        auth: {
          username: username,
          password: password,
        },
      }
    );
    console.log("delete participant response:", resp.status, resp.data);
  } catch (e) {
    if (e.response.status === 404) {
      // participants can get deleted when the media server detects loss of session / media flows
      console.log("participant already deleted", participantId);
    } else {
      console.log("failure to delete participant", participantId);
      console.log("error", e.response.status, e.response.data, e.config.url);
    }
  }
};

/**
 * Ask Bandwidth's Voice API to call the outbound phone number,
 * with an answer callback that will conference the outbound call on the V2 voice
 * side of the infrastructure
 */
const callPhone = async (phoneNumber: string) => {
  try {
    let response = await axios.post(
      `https://voice.bandwidth.com/api/v2/accounts/${accountId}/calls`,
      {
        from: voiceApplicationPhoneNumber,
        to: phoneNumber,
        answerUrl: `${voiceCallbackUrl}/callAnswered`,
        disconnectUrl: `${voiceCallbackUrl}/callStatus`,
        applicationId: voiceApplicationId,
      },
      {
        auth: {
          username: username,
          password: password,
        },
      }
    );
    const callId = response.data.callId;
    console.log(`initiated call ${callId} to ${phoneNumber}...`);
  } catch (e) {
    console.log(`error calling ${phoneNumber}: ${e}`);
  }
};

/**
 * Ask Bandwidth's Voice API to call the webRTC infrastructure with the
 * participant token in the UUI SIP header to allow the correlation of
 * V2 voice and the webRTC infrastructure
 */
const callSipUri = async (participant: Participant) => {
  try {
    const body = {
      from: voiceApplicationPhoneNumber,
      to: "sip:sipx.webrtc.bandwidth.com:5060",
      answerUrl: `${voiceCallbackUrl}/bridgeCallAnswered`,
      disconnectUrl: `${voiceCallbackUrl}/callStatus`,
      applicationId: voiceApplicationId,
      uui: `${participant.token};encoding=jwt`,
    };
    console.log("calling a SIP URL", body);
    let response = await axios.post(
      `https://voice.bandwidth.com/api/v2/accounts/${accountId}/calls`,
      body,
      {
        auth: {
          username: username,
          password: password,
        },
      }
    );
    const callId = response.data.callId;
    console.log(`setting calls in SIPURI for ${callId}`);
    return response;
  } catch (e) {
    console.log(`error calling sip:sipx.webrtc.bandwidth.com:5060: ${e}`);
  }
};

/**
 * remove the SIP URI leg from between the V2 Voice infrastructure and the
 * WebRTC infrastructure
 */
const killSipUriLeg = async (participant: Participant) => {
  try {
    // kill the call and the conference should come down when empty
    // find the callId

    let callId: string = "";
    for (let [key, value] of voiceCalls.entries()) {
      console.log("hunting for callId:", key, value);
      if (value.bridge) callId = key;
    }

    if (!callId) {
      throw "callId not found for sipx bridge";
    }

    if (!participant) {
      throw "participant not found for sipx bridge";
    }

    console.log(
      `killing the SIP URI Leg - callId: ${callId} participant: ${participant.id}`
    );

    let response = await axios.post(
      `https://voice.bandwidth.com/api/v2/accounts/${accountId}/calls/${callId}`,
      {
        state: "completed",
      },
      {
        auth: {
          username: username,
          password: password,
        },
      }
    );
    console.log(
      `Deleted conference sipx leg response ${response.status} - data -  ${response.data}`
    );
  } catch (e) {
    console.log(
      `error killing the sip:sipx.webrtc.bandwidth.com:5060 leg: ${participant} ${e}`
    );
  }
};
