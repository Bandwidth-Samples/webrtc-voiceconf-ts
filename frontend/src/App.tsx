import React, { useState, useEffect } from "react";
import "./App.css";

import BandwidthRtc, { RtcStream } from "@bandwidth/webrtc-browser";

const bandwidthRtc = new BandwidthRtc();

const App: React.FC = () => {
  // We will use these state variables to hold our device token and application phone number
  const [token, setToken] = useState<string>();
  const [voiceApplicationPhoneNumber, setVoiceApplicationPhoneNumber] =
    useState<string>();
  const [outboundPhoneNumber, setOutboundPhoneNumber] = useState<string>();

  // This state variable holds the remote stream object - the audio from the phone
  const [remoteStream, setRemoteStream] = useState<RtcStream>();

  // This effect connects to our server backend to get a device token
  // It will only run the first time this component renders
  useEffect(() => {
    fetch("/connectionInfo").then(async (response) => {
      const responseBody = await response.json();
      setToken(responseBody.token);
      setVoiceApplicationPhoneNumber(responseBody.voiceApplicationPhoneNumber);
      setOutboundPhoneNumber("");
    });
  }, []);

  // This effect will fire when the token changes
  // It will connect a websocket to Bandwidth WebRTC, and start streaming the browser's mic
  useEffect(() => {
    if (token) {
      // Connect to Bandwidth WebRTC
      bandwidthRtc
        .connect({
          deviceToken: token,
        })
        .then(async () => {
          console.log("connected to bandwidth webrtc!");
          // Publish the browser's microphone
          await bandwidthRtc.publish({
            audio: true,
            video: false,
          });
          console.log("browser mic is streaming");
        });
    }
  }, [token]);

  // This effect sets up event SDK event handlers for remote streams
  useEffect(() => {
    // This event will fire any time a new stream is sent to us
    bandwidthRtc.onStreamAvailable((rtcStream: RtcStream) => {
      console.log("receiving audio!");
      setRemoteStream(rtcStream);
    });

    // This event will fire any time a stream is no longer being sent to us
    bandwidthRtc.onStreamUnavailable((endpointId: string) => {
      console.log("no longer receiving audio");
      setRemoteStream(undefined);
    });
  });

  // Initiate a call to the outbound phone number listed
  const callOutboundPhoneNumber = () => {
    console.log(`calling ${outboundPhoneNumber}`);
    let data = { calledTelephoneNumber: outboundPhoneNumber };
    fetch("/callPhone", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    }).then(async (response) => {
      if (response.ok) {
        console.log("Ringing...");
      } else {
        console.log("Something went wrong");
      }
    });
  };

  const updateTn = (element: React.ChangeEvent<HTMLInputElement>) => {
    const invalid = !element.target.value.match(/^\+1[2-9][0-9]{9}$/);
    if (!invalid) {
      setOutboundPhoneNumber(element.target.value);
    } else setOutboundPhoneNumber("");
    console.log(outboundPhoneNumber);
  };

  // was checking for the existence of remoteStream

  console.log(outboundPhoneNumber, outboundPhoneNumber?.length);

  return (
    <div className="App">
      <header className="App-header">
        <div>WebRTC Hello World</div>
        {remoteStream ? (
          <div>
            <div>
              <video
                playsInline
                autoPlay
                style={{ display: "none" }}
                ref={(videoElement) => {
                  if (
                    videoElement &&
                    remoteStream &&
                    videoElement.srcObject !== remoteStream.mediaStream
                  ) {
                    // Set the video element's source object to the WebRTC MediaStream
                    videoElement.srcObject = remoteStream.mediaStream;
                  }
                }}
              ></video>
              Hooray! You're connected!
            </div>
          </div>
        ) : (
          <div>
            <span>connecting...</span>
          </div>
        )}
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <span>click to call from {voiceApplicationPhoneNumber}</span>
            <button
              style={{ height: "30px", marginLeft: "10px" }}
              disabled={outboundPhoneNumber?.length === 0}
              onClick={callOutboundPhoneNumber}
            >
              CALL
            </button>
            <input
              type="text"
              name="numberToDial"
              id="numberToDial"
              placeholder="enter a phone number"
              style={{ height: "30px", marginLeft: "10px" }}
              onChange={updateTn}
            />
          </div>
        </div>
      </header>
    </div>
  );
};

export default App;
