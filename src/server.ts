import path from "path";
import dotenv from "dotenv";
import express, { response } from "express";
import bodyParser from "body-parser";
import axios from "axios";
import {
  Conference,
  ApiCreateCallRequest,
  ApiModifyCallRequest,
  Client as VoiceClient,
  ApiController as VoiceController,
  Response,
  State1Enum,
  SpeakSentence,
  ApiResponse,
} from "@bandwidth/voice";
import {
  Client as WebRtcClient,
  Session,
  Participant,
  PublishPermissionEnum,
  Subscriptions,
  ApiController as WebRtcController,
  DeviceApiVersionEnum,
} from "@bandwidth/webrtc";

// const bandwidthWebRTC = require("@bandwidth/webrtc");

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

interface ParticipantInfo {
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

const webRTCClient = new WebRtcClient({
  basicAuthUserName: username,
  basicAuthPassword: password,
});
const webRTCController = new WebRtcController(webRTCClient);

const voiceClient = new VoiceClient({
  basicAuthUserName: username,
  basicAuthPassword: password,
});
const voiceController = new VoiceController(voiceClient);

let sessionId: string;
let voiceCalls: Map<string, CallData> = new Map();
let bridgeParticipant: ParticipantInfo;
let webParticipant: ParticipantInfo;

process.on("SIGINT", async function () {
  if (bridgeParticipant) {
    await killSipUriLeg(bridgeParticipant);
    await deleteParticipant(bridgeParticipant);
  }
  if (webParticipant) {
    await deleteParticipant(webParticipant);
  }
  if (sessionId) {
    await deleteSession();
  }
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
  });
  bridgeParticipant = await createParticipant("hello-world-phone");
  const createCallResponse = await callSipUri(bridgeParticipant);
  console.log("initial configuration activities in motion");
});

/**
 * The killConnection endpoint cleans up all resources, used as a callback
 * on the loss of media flow to the controlling Web Browser.
 */
app.post("/killConnection", async (req, res) => {
  res.send();

  if (
    req.body.event === "onLeave" &&
    webParticipant &&
    req.body.participantId == webParticipant.id
  ) {
    // TODO - move the null check inside of the functions
    console.log("deallocating all configured resources on exit");
    await killSipUriLeg(bridgeParticipant);
    await deleteParticipant(bridgeParticipant);
    await deleteParticipant(webParticipant);
    await deleteSession();
  }
});

/**
 * The browser will hit this endpoint to initiate a call to the outbound phone number
 */
app.post("/callPhone", async (req, res) => {
  console.log("calling a phone", req.body.calledTelephoneNumber);
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
  const callId = req.body.callId;
  console.log(
    `received answered callback for bridging call ${callId} to ${req.body.to}`
  );

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

  const resp = new Response();
  resp.add(conf);

  console.log("creating Programmable Voice conference bridge:", resp.toBxml());
  res.contentType("application/xml").send(resp.toBxml());
});

/**
 * Bandwidth's Voice API will hit this endpoint when an outgoing call is answered
 * the outboud call will be connected to a conference bridge
 */
app.post("/callAnswered", async (req, res) => {
  const callId = req.body.callId;
  console.log(
    `received answered callback for outbound call ${callId} to ${req.body.to}`
  );

  // preserve the call-leg
  let data: CallData = {
    from: req.body.from,
    to: req.body.to,
    bridge: false,
  };

  voiceCalls.set(callId, data); // preserve the info on the bridge leg in the calls map.

  const conf = new Conference({
    name: sessionId,
    callIdsToCoach: undefined,
  });

  const speak = new SpeakSentence({
    sentence: "You are about to talk to an amazing person.",
    voice: "bridget",
  });

  const resp = new Response();
  resp.add(speak);
  resp.add(conf);

  console.log(
    `conferencing outbound call using Programmable Voice - ${callId}`
  );
  console.log("Voice conference bridge BXML:", resp.toBxml());
  res.contentType("application/xml").send(resp.toBxml());
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
        deleteParticipant(bridgeParticipant);
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
      let getSessionResponse = await webRTCController.getSession(
        accountId,
        sessionId
      );
      const existingSession: Session = getSessionResponse.result;
      console.log(`using session ${sessionId}`);
      if (existingSession.id === sessionId) {
        return sessionId;
      } else
        throw Error(
          `saved session IDs don't match ${existingSession.id}, ${sessionId}`
        );
    } catch (e) {
      console.log(`session ${sessionId} is invalid, creating a new session`);
    }
  }

  // Otherwise start a new one and return the ID
  const createSessionBody: Session = {
    tag: "v2-voice-conference-model",
  };
  let response = await webRTCController.createSession(
    accountId,
    createSessionBody
  );
  if (!response.result.id) {
    throw Error("No Session ID in Create Session Response");
  }
  sessionId = response.result.id;
  console.log(`created new session ${sessionId}`);
  return sessionId;
};

/**
 * Create a new participant and save their ID to our app's state map
 */
const createParticipant = async (tag: string): Promise<ParticipantInfo> => {
  // Create a new participant
  console.log(`creating a participant at ${callControlUrl}/participants`);
  const participantBody: Participant = {
    tag: tag,
    publishPermissions: [PublishPermissionEnum.AUDIO],
    deviceApiVersion: DeviceApiVersionEnum.V3,
    callbackUrl: `${voiceCallbackUrl}/killConnection`,
  };

  let createParticipantResponse = await webRTCController.createParticipant(
    accountId,
    participantBody
  );
  const participant = createParticipantResponse.result.participant;

  if (!participant?.id) {
    throw Error("the participant was not returned");
  }
  const participantId = participant?.id;
  if (!createParticipantResponse.result.token) {
    throw Error("the token was not returned");
  }
  const token = createParticipantResponse.result.token;

  console.log(`created new participant ${participantId}`);

  // Add participant to session
  const sessionId = await getSessionId();
  const subscriptions: Subscriptions = {
    sessionId: sessionId,
  };

  await webRTCController.addParticipantToSession(
    accountId,
    sessionId,
    participantId,
    subscriptions
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
      await webRTCController.deleteSession(accountId, sessionId);
      console.log(`Deleted WebRTC session: ${sessionId} `);
      sessionId = "";
    } catch (e) {
      let error: ApiResponse<void> = e as ApiResponse<void>;
      console.log("failed to delete session", sessionId);
      console.log(
        "error",
        error.request,
        error.headers,
        error.statusCode,
        error.body
      );
    }
  }
};

/**
 * Delete a participant
 */
const deleteParticipant = async (participant: ParticipantInfo) => {
  try {
    if (participant.id) {
      await webRTCController.deleteParticipant(accountId, participant.id);
    }
    console.log(`Deleted Participant ${participant.id}`);
  } catch (e) {
    let error: ApiResponse<void> = e as ApiResponse<void>;
    if (error.statusCode === 404) {
      // participants can get deleted when the media server detects loss of session / media flows
      console.log("participant already deleted", participant.id);
    } else {
      console.log("failure to delete participant", participant.id);
      console.log(
        "error",
        error.request,
        error.headers,
        error.statusCode,
        error.body
      );
    }
  }
};

/**
 * Ask Bandwidth's Voice API to call the outbound phone number,
 * with an answer callback that will conference the outbound call on the V2 voice
 * side of the infrastructure
 */
const callPhone = async (phoneNumber: string) => {
  const createCallRequest: ApiCreateCallRequest = {
    from: voiceApplicationPhoneNumber,
    to: phoneNumber,
    answerUrl: `${voiceCallbackUrl}/callAnswered`,
    disconnectUrl: `${voiceCallbackUrl}/callStatus`,
    applicationId: voiceApplicationId,
  };
  try {
    let response = await voiceController.createCall(
      accountId,
      createCallRequest
    );
    const callId = response.result.callId;
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

// TODO - upgrade from axios when the SDK supports UUI

const callSipUri = async (participant: ParticipantInfo) => {
  try {
    const body = {
      from: voiceApplicationPhoneNumber,
      to: "sip:sipx.webrtc.bandwidth.com:5060",
      answerUrl: `${voiceCallbackUrl}/bridgeCallAnswered`,
      disconnectUrl: `${voiceCallbackUrl}/callStatus`,
      applicationId: voiceApplicationId,
      uui: `${participant.token};encoding=jwt`,
    };
    console.log("calling the SIP URL");
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
      if (value.bridge) {
        callId = key;
      }
    }

    if (!callId) {
      console.log(
        "callId not found for sipx bridge - it must have been removed already"
      );
    } else if (!participant) {
      console.log(
        "participant not found for sipx bridge - it must have been removed already"
      );
    } else {
      console.log(
        `Removing the bridging SIP Call Leg - callId: ${callId} participant: ${participant.id}`
      );

      const modifyCallRequest: ApiModifyCallRequest = {
        state: State1Enum.Completed,
        redirectUrl: "",
      };
      try {
        let response = await voiceController.modifyCall(
          accountId,
          callId,
          modifyCallRequest
        );
        console.log(`ending call ${callId}`);
      } catch (e) {
        console.log(`error in ending call ${callId}: ${e}`);
      }
      if (!voiceCalls.delete(callId)) {
        console.log(
          `failed to remove sipx bridge leg ${callId} - it was likely previously deleted`
        );
      } else {
        console.log(`Deleted conference sipx leg`);
      }
    }
  } catch (e) {
    console.log(`failed to kill the sip:sipx.webrtc.bandwidth.com:5060 leg.`);
    console.log(e);
  }
};
