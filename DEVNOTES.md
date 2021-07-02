
## Implemented Conference case
Baseline with conference
1) Web Participant
2) Session
3) SIP Participant
4) Creating the Call from V2 Voice
4a) Answer Handling on Bridging leg
5) Creating a voice conference bridge - 
6) calling a phone +18045030091
6a) conferencing outbound call
7) Disconnecting the outbound call
8) cleanup

## Speculative Bridge case
Bridge
1) Web Participant
2) Session
3) SIP Participant
4) Creating the Call from V2 Voice
4a) Answer Handling on Bridging leg
5) >>> Holding the Bridging Leg - 
6) calling a phone +18045030091
6a) >>> Bridging outbound call
7) Disconnecting the outbound call
7a) >>> Holding the Bridging call
8) cleanup

## Speculative Transfer case
Transfer (entire call should fall down on far end disconnect)
1) Web Participant
2) Session
3) SIP Participant
4) Creating the Call from V2 Voice
4a) Answer Handling on Bridging leg
5) >>> Holding the Bridging Leg - 
6) >>> Transferring the held call to +18045030091
7) >>> Disconnecting the outbound call
7a) >>> The Bridging call comes down
8) cleanup

## logging from conferencing case

```
1) Web Participant - creating a participant at https://api.webrtc.bandwidth.com/v1/accounts/9901078/participants
created new participant c6fe231a-b7de-4bd3-8dd8-7667e033b3b1
2) Session - created new session c2a38655-a385-4f70-9732-474bde1e6b27
3) SIP Participant - creating a participant at https://api.webrtc.bandwidth.com/v1/accounts/9901078/participants
created new participant d68937c4-71b4-4ed1-b297-dafc0b6a9562
using session [object Object], c2a38655-a385-4f70-9732-474bde1e6b27
4) Creating the Call from V2 Voice - calling a SIP URL {
  from: '+19197047511',
  to: 'sip:sipx.webrtc.bandwidth.com:5060',
  answerUrl: 'https://f588791d5cf4.ngrok.io/bridgeCallAnswered',
  disconnectUrl: 'https://f588791d5cf4.ngrok.io/callStatus',
  applicationId: 'e026e290-1749-4cf2-b104-a3aed3fbd720',
  uui: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhIjoiOTkwMTA3OCIsInAiOiJkNjg5MzdjNC03MWI0LTRlZDEtYjI5Ny                               1kYWZjMGI2YTk1NjIiLCJ2IjoiVjMiLCJleHAiOjE2MjUwNTg2ODAsInRpZCI6IisyNjk5Nzc0NzE1MDgzMjAifQ.1QAHKcJSwFnJO5                               KSkEONt084_sZKqQdDhvsGn649Yys;encoding=jwt'
}
setting calls in SIPURI for c-d45a41e5-dae6c964-7238-414a-801b-3e60227fb473
initial configuration activities in motion
4a) Answer Handling on Bridging leg - received answered callback for bridging call c-d45a41e5-dae6c964-7238-414a-801b-3e60227fb473 to sip:sipx.webrtc.bandwidth.com:5060
5) Creating a voice conference bridge - 
creating Programmable Voice conference bridge: <?xml version="1.0" encoding="UTF-8"?><Response><ConferencecallIdsToCoach="">c2a38655-a385-4f70-9732-474bde1e6b27</Conference></Response>
6) calling a phone +18045030091
initiated call c-93d6f3c0-488aff09-7eed-431b-872a-0079dfeb2a1a to +18045030091...
received answered callback for outbound call c-93d6f3c0-488aff09-7eed-431b-872a-0079dfeb2a1a to +18045030091
6a) conferencing outbound call using Programmable Voice - c-93d6f3c0-488aff09-7eed-431b-872a-0079dfeb2a1a
7) Disconnecting the outbound call - received disconnect event for call c-93d6f3c0-488aff09-7eed-431b-872a-0079dfeb2a1a
8) cleanup
deallocating all configured resources on exit
Removing the bridging SIP Call Leg - callId: c-d45a41e5-dae6c964-7238-414a-801b-3e60227fb473 participant: d68937c4-71b4-4ed1-b297-dafc0b6a9562
Ending call c-d45a41e5-dae6c964-7238-414a-801b-3e60227fb473
Deleted conference sipx leg
received disconnect event for call c-d45a41e5-dae6c964-7238-414a-801b-3e60227fb473
Deleted Participant d68937c4-71b4-4ed1-b297-dafc0b6a9562
Deleted Participant c6fe231a-b7de-4bd3-8dd8-7667e033b3b1
Deleted WebRTC session: c2a38655-a385-4f70-9732-474bde1e6b27
failed to kill the sip:sipx.webrtc.bandwidth.com:5060 leg.
callId not found for sipx bridge
```
