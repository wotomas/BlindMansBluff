# Mina Project

This project is WIP created for learning and practicing Mina during Bootcamp 2021.

## Blind Man's Bluff (a.k.a Indian Poker)
[![IMAGE ALT TEXT](http://img.youtube.com/vi/wMSaGbIaOdE/0.jpg)](https://www.youtube.com/watch?v=wMSaGbIaOdE "Blind Man's Bluff Intro")

A Blind Man's Bluff is a simplified version of poker where each peron sees the cards of all players except their own. I
am going to implement a standard version where simply high card wins. Each player is dealt one card which is displayed
to all other players but him or herself. This is followed by a round of betting. Player can raise or fold and the last
person standing or the one with the highest card wins.

### Disclaimer (2021.12.12)
The description above was what I planned to build. The current version consists of round of ante betting (an initial
forced bet for all players before the dealing begins) phase, rough implementation of card dealing and game win status verifying. 
In conclusion, the circuits enabling `turnless betting` were tested that enables round of initial betting, yet actual game part needs more improvement.

### Build & Run

```console
$ git clone https://github.com/wotomas/BlindMansBluff.git
$ cd BlindMansBluff
$ yarn
$ yarn blind
```

Make sure you have node version >= 16.4!

## An Abstract version of UI

User interface is not going to be developed in this version. Each user will be facing a board with N-1 cards, where N is
total number of players. User should be able to GET whose turn currently is to bet, the total pot of the game, the phase
of the game. User should be able to POST his or her action (Fold or Raise) with addition of Mina. In short the UI will
be requesting snapps for the following state and should have features to update the state with following interfaces:

- GET:   is it currently my turn to act
- GET:   total pot (balance) of the game (balance of the contract)
- GET:   game phase (state): Ante Phase, Bet Phase, Result Phase
- POST:  pay Ante to be involved in the game
- POST:  an action (Fold and Raise) to correctly update the state

## The High-level flow of the Ante Logic

1. When the game starts, it is time for ante betting, which is a forced betting phase for all players before
   the dealing begins.
2. All users should call the `payAnte(publicKey, sig, anteBetAmount)` in order to change the game phase to betting phase
3. First we need to assert the correct state of the game.
4. Personally this was the tricky part combining multiple `Bool` states using `Circuit.or` and `Circuit.and` to modify
   only the states that I want to modify.
5. Abstract version is represented below

### Verification of `Can I pay Ante now?`

Since the Ante betting does not have turns to pay, I had to change the number of users to 2, in order to make this
verification work. The contract will know if the caller of the contract is player One or Two by checking it through the
saved public keys and return a Bool value `isPlayerOne`.

Initially the player is eligible to pay ante if: 
1. If it is player one, player one has not paid yet (index 2, 4 below)
2. If it is player two, player two has not paid yet (index 1, 5 below)
3. on all other cases, it should follow the other player's state

```
// index                1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
// isPlayerOne     (A)  F | T | T | T | F | F | T | F
// isPlayerOnePaid (B)  F | F | T | F | T | F | T | T
// isPlayerTwoPaid (C)  F | F | F | T | F | T | T | T
// result          (Y)  T | T | F | T | T | F | F | F
```
eventually according to the truth table, the circuit could be derived to the following:
```
// Y = A'B'C' + AB'C' + AB'C + A'BC'
//   => or(and(not(a), not(b), not(c)), and(a, not(b), not(c)), and(a, not(b), c), and(not(a), b, not(c))
```
the circuit that i have to work with is `or(and(not(a), not(b), not(c)), and(a, not(b), not(c)), and(a, not(b), c), and(not(a), b, not(c))`
I am sure there is a way to simplify this... 

but for now, lets use this circuit to verify if user is eligible to pay ante.
```
    // first verify if the game state is good to pay ante for either players
    const isGoodToPayAnte = Bool.or(
      Bool.or(
        Bool.and(
          Bool.and(
            isPlayerOne.not(),
            isPlayerOnePaidAnte.not(),
          ),
          isPlayerTwoPaidAnte.not(),
        ),
        Bool.and(
          Bool.and(
            isPlayerOne,
            isPlayerOnePaidAnte.not(),
          ),
          isPlayerTwoPaidAnte.not(),
        ),
      ),
      Bool.or(
        Bool.and(
          Bool.and(
            isPlayerOne,
            isPlayerOnePaidAnte.not(),
          ),
          isPlayerTwoPaidAnte,
        ),
        Bool.and(
          Bool.and(
            isPlayerOne.not(),
            isPlayerOnePaidAnte,
          ),
          isPlayerTwoPaidAnte.not(),
        ),
      ),
    );
    
    isGoodToPayAnte.assertEquals(true);
```

### The actual update of states after verification
After the verification is good to go, now we need to update the state accordingly. 
When Player 2 calls the method, it should not alter the Player 1's state, and visa versa.
So this ends up being two joined circuits, which is the following:
```
    // isPlayerOne      (A) T | T | F | F
    // isPlayerOnePaid  (B) T | F | T | F
    // result           (Y) F | T | T | F
    // if it is player one's call, check and update, if it's player two's call, just use (B) value
    // Y = AB' + A'B
    //   => or(and(a, not(b)), and(not(a), b))
    const y = Bool.or(
      Bool.and(
        isPlayerOne,
        isPlayerOnePaidAnte.not(),
      ),
      Bool.and(
        isPlayerOne.not(),
        isPlayerOnePaidAnte,
      ))
      
    // isPlayerOne      (A) T | T | F | F
    // isPlayerTwoPaid  (C) T | F | T | F
    // result           (Y')T | F | F | T
    // same logic with player one, but inverse
    // yy = AC + A'C'
    //   => or(and(a, c), and(not(a), not(b)))
    const yy = Bool.or(
      Bool.and(isPlayerOne, isPlayerTwoPaidAnte),
      Bool.and(isPlayerOne.not(), isPlayerTwoPaidAnte.not()),
    );
    
    this.anteOne.set(new Bool(y));
    this.anteTwo.set(new Bool(yy));
    
    // when everyone is done paying there ante, change game phase
    const isEveryoneReady = Bool.and(
      await this.anteOne.get(),
      await this.anteTwo.get()
    );

    this.isAntePhaseDone.set(isEveryoneReady);
```

### Mini conclusion for Ante Phase
That circuit was able to implement a `turnless betting phase`.
I might be going on a wrong route. 
Should check with other's submission for more reference.
But all the samples had turns in the game, which I wanted to implement was a more
flexible state for betting (which i am not sure if i accomplished)

## The High-level flow of the Initializing and Betting Phase
This part should be very similar with the tictactoe sample, but with some twist in the init section.
The initial idea is that the Smart Contract will know who is the winner without having to store the actual number of cards.
So the smart contract doesn't store both numbers, but can prove you that User One won. 
```
winningHash = hash([userOneNumber, userTwoNumber, didUserOneWin])
```
Since the game only uses number with upper bound, this could be broken through brute force, but the idea seems to be there.

Once everyone is done betting, the game ends and does payout. (which still needs to be implemented)
