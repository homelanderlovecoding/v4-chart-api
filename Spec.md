Hey claude 

REQUIREMENT:
I want to build an app api service (websock for realtime) which is 
- listen swap event on uniswap contract v4
- store these event in the mongodb 
- fire event to subcribers thru websocket

Also have internval to update more info for Day/hour/minute
- Volume
- OHLC (Open-High-Low-Close) or Candlestick Charts
(refe to this repo https://github.com/Uniswap/v4-subgraph)

TECH STACK:
- nestjs framework (typescript)
- mongodb


TESTS:
- write some tests to listen and store event 