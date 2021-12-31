import { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import {
  CircularProgress,
  Container,
  IconButton,
  Link,
  Slider,
  Snackbar,
} from '@material-ui/core';
import Paper from '@material-ui/core/Paper';
import Typography from '@material-ui/core/Typography';
import Grid from '@material-ui/core/Grid';
import { createStyles, Theme } from '@material-ui/core/styles';
import Dialog from '@material-ui/core/Dialog';
import MuiDialogTitle from '@material-ui/core/DialogTitle';
import MuiDialogContent from '@material-ui/core/DialogContent';
import CloseIcon from '@material-ui/icons/Close';

import Alert from '@material-ui/lab/Alert';

import * as anchor from '@project-serum/anchor';

import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';

import { useWallet } from '@solana/wallet-adapter-react';
import { WalletDialogButton } from '@solana/wallet-adapter-material-ui';

import {
  awaitTransactionSignatureConfirmation,
  CandyMachineAccount,
  CANDY_MACHINE_PROGRAM,
  getCandyMachineState,
  mintOneToken,
} from './candy-machine';

import {
  FairLaunchAccount,
  getFairLaunchState,
  punchTicket,
  purchaseTicket,
} from './fair-launch';

import { AlertState, formatNumber, getAtaForMint, toDate } from './utils';
import { CTAButton, MintButton } from './MintButton';
import { AntiRug } from './AntiRug';
import { getPhase, Phase, PhaseHeader } from './PhaseHeader';
import { GatewayProvider } from '@civic/solana-gateway-react';

const ConnectButton = styled(WalletDialogButton)`
  width: 100%;
  height: 60px;
  margin-top: 10px;
  margin-bottom: 5px;
  background: linear-gradient(180deg, #604ae5 0%, #813eee 100%);
  color: white;
  font-size: 16px;
  font-weight: bold;
`;

const MintContainer = styled.div``; // add your styles here

const dialogStyles: any = (theme: Theme) =>
  createStyles({
    root: {
      margin: 0,
      padding: theme.spacing(2),
    },
    closeButton: {
      position: 'absolute',
      right: theme.spacing(1),
      top: theme.spacing(1),
      color: theme.palette.grey[500],
    },
  });

const ValueSlider = styled(Slider)({
  color: '#C0D5FE',
  height: 8,
  '& > *': {
    height: 4,
  },
  '& .MuiSlider-track': {
    border: 'none',
    height: 4,
  },
  '& .MuiSlider-thumb': {
    height: 24,
    width: 24,
    marginTop: -10,
    background: 'linear-gradient(180deg, #604AE5 0%, #813EEE 100%)',
    border: '2px solid currentColor',
    '&:focus, &:hover, &.Mui-active, &.Mui-focusVisible': {
      boxShadow: 'inherit',
    },
    '&:before': {
      display: 'none',
    },
  },
  '& .MuiSlider-valueLabel': {
    '& > *': {
      background: 'linear-gradient(180deg, #604AE5 0%, #813EEE 100%)',
    },
    lineHeight: 1.2,
    fontSize: 12,
    padding: 0,
    width: 32,
    height: 32,
    marginLeft: 9,
  },
});

export interface HomeProps {
  candyMachineId?: anchor.web3.PublicKey;
  fairLaunchId?: anchor.web3.PublicKey;
  connection: anchor.web3.Connection;
  startDate: number;
  txTimeout: number;
  rpcHost: string;
}

const FAIR_LAUNCH_LOTTERY_SIZE =
  8 + // discriminator
  32 + // fair launch
  1 + // bump
  8; // size of bitmask ones

const isWinner = (fairLaunch: FairLaunchAccount | undefined): boolean => {
  if (
    !fairLaunch?.lottery.data ||
    !fairLaunch?.lottery.data.length ||
    !fairLaunch?.ticket.data?.seq ||
    !fairLaunch?.state.phaseThreeStarted
  ) {
    return false;
  }

  const myByte =
    fairLaunch.lottery.data[
      FAIR_LAUNCH_LOTTERY_SIZE +
        Math.floor(fairLaunch.ticket.data?.seq.toNumber() / 8)
    ];

  const positionFromRight = 7 - (fairLaunch.ticket.data?.seq.toNumber() % 8);
  const mask = Math.pow(2, positionFromRight);
  const isWinner = myByte & mask;
  return isWinner > 0;
};

const Home = (props: HomeProps) => {
  const [fairLaunchBalance, setFairLaunchBalance] = useState<number>(0);
  const [yourSOLBalance, setYourSOLBalance] = useState<number | null>(null);
  const rpcUrl = props.rpcHost;

  const [isMinting, setIsMinting] = useState(false); // true when user got to press MINT
  const [contributed, setContributed] = useState(0);

  const wallet = useWallet();

  const anchorWallet = useMemo(() => {
    if (
      !wallet ||
      !wallet.publicKey ||
      !wallet.signAllTransactions ||
      !wallet.signTransaction
    ) {
      return;
    }

    return {
      publicKey: wallet.publicKey,
      signAllTransactions: wallet.signAllTransactions,
      signTransaction: wallet.signTransaction,
    } as anchor.Wallet;
  }, [wallet]);

  const [alertState, setAlertState] = useState<AlertState>({
    open: false,
    message: '',
    severity: undefined,
  });

  const [fairLaunch, setFairLaunch] = useState<FairLaunchAccount>();
  const [candyMachine, setCandyMachine] = useState<CandyMachineAccount>();
  const [howToOpen, setHowToOpen] = useState(false);
  const [refundExplainerOpen, setRefundExplainerOpen] = useState(false);

  const onMint = async () => {
    try {
      setIsMinting(true);
      document.getElementById('#identity')?.click();
      if (wallet.connected && candyMachine?.program && wallet.publicKey) {
        if (fairLaunch?.ticket.data?.state.unpunched && isWinner(fairLaunch)) {
          await onPunchTicket();
        }

        const mintTxId = (
          await mintOneToken(candyMachine, wallet.publicKey)
        )[0];

        let status: any = { err: true };
        if (mintTxId) {
          status = await awaitTransactionSignatureConfirmation(
            mintTxId,
            props.txTimeout,
            props.connection,
            'singleGossip',
            true,
          );
        }

        if (!status?.err) {
          setAlertState({
            open: true,
            message: 'Congratulations! Mint succeeded!',
            severity: 'success',
          });
        } else {
          setAlertState({
            open: true,
            message: 'Mint failed! Please try again!',
            severity: 'error',
          });
        }
      }
    } catch (error: any) {
      // TODO: blech:
      let message = error.msg || 'Minting failed! Please try again!';
      if (!error.msg) {
        if (!error.message) {
          message = 'Transaction Timeout! Please try again.';
        } else if (error.message.indexOf('0x138')) {
        } else if (error.message.indexOf('0x137')) {
          message = `SOLD OUT!`;
        } else if (error.message.indexOf('0x135')) {
          message = `Insufficient funds to mint. Please fund your wallet.`;
        }
      } else {
        if (error.code === 311) {
          message = `SOLD OUT!`;
          window.location.reload();
        } else if (error.code === 312) {
          message = `Minting period hasn't started yet.`;
        }
      }

      setAlertState({
        open: true,
        message,
        severity: 'error',
      });
    } finally {
      setIsMinting(false);
    }
  };

  useEffect(() => {
    (async () => {
      if (!anchorWallet) {
        return;
      }

      try {
        const balance = await props.connection.getBalance(
          anchorWallet.publicKey,
        );
        setYourSOLBalance(balance);

        if (props.fairLaunchId) {
          const state = await getFairLaunchState(
            anchorWallet,
            props.fairLaunchId,
            props.connection,
          );

          setFairLaunch(state);

          try {
            if (state.state.tokenMint) {
              const fairLaunchBalance =
                await props.connection.getTokenAccountBalance(
                  (
                    await getAtaForMint(
                      state.state.tokenMint,
                      anchorWallet.publicKey,
                    )
                  )[0],
                );

              if (fairLaunchBalance.value) {
                setFairLaunchBalance(fairLaunchBalance.value.uiAmount || 0);
              }
            }
          } catch (e) {
            console.log('Problem getting fair launch token balance');
            console.log(e);
          }
          if (contributed === 0) {
            const phase = getPhase(state, undefined);

            if (phase === Phase.SetPrice) {
              const ticks =
                (state.state.data.priceRangeEnd.toNumber() -
                  state.state.data.priceRangeStart.toNumber()) /
                state.state.data.tickSize.toNumber();
              const randomTick = Math.round(Math.random() * ticks);

              setContributed(
                (state.state.data.priceRangeStart.toNumber() +
                  randomTick * state.state.data.tickSize.toNumber()) /
                  LAMPORTS_PER_SOL,
              );
            } else {
              setContributed(
                (
                  state.state.currentMedian || state.state.data.priceRangeStart
                ).toNumber() / LAMPORTS_PER_SOL,
              );
            }
          }
        } else {
          console.log('No fair launch detected in configuration.');
        }
      } catch (e) {
        console.log('Problem getting fair launch state');
        console.log(e);
      }
      if (props.candyMachineId) {
        try {
          const cndy = await getCandyMachineState(
            anchorWallet,
            props.candyMachineId,
            props.connection,
          );
          setCandyMachine(cndy);
        } catch (e) {
          console.log('Problem getting candy machine state');
          console.log(e);
        }
      } else {
        console.log('No candy machine detected in configuration.');
      }
    })();
  }, [
    anchorWallet,
    props.candyMachineId,
    props.connection,
    props.fairLaunchId,
    contributed,
  ]);

  const min = formatNumber.asNumber(fairLaunch?.state.data.priceRangeStart);
  const max = formatNumber.asNumber(fairLaunch?.state.data.priceRangeEnd);
  const step = formatNumber.asNumber(fairLaunch?.state.data.tickSize);
  const median = formatNumber.asNumber(fairLaunch?.state.currentMedian);
  const phase = getPhase(fairLaunch, candyMachine);
  console.log('Phase', phase);
  const marks = [
    {
      value: min || 0,
      label: `${min} SOL`,
    },
    // TODO:L
    ...(phase === Phase.SetPrice
      ? []
      : [
          {
            value: median || 0,
            label: `${median}`,
          },
        ]),
    // display user comitted value
    // {
    //   value: 37,
    //   label: '37°C',
    // },
    {
      value: max || 0,
      label: `${max} SOL`,
    },
  ].filter(_ => _ !== undefined && _.value !== 0) as any;

  const onDeposit = async () => {
    if (!anchorWallet) {
      return;
    }

    console.log('deposit');
    setIsMinting(true);
    try {
      await purchaseTicket(contributed, anchorWallet, fairLaunch);
      setIsMinting(false);
      setAlertState({
        open: true,
        message: `Congratulations! Bid ${
          fairLaunch?.ticket.data ? 'updated' : 'inserted'
        }!`,
        severity: 'success',
      });
    } catch (e) {
      console.log(e);
      setIsMinting(false);
      setAlertState({
        open: true,
        message: 'Something went wrong.',
        severity: 'error',
      });
    }
  };
  const onRefundTicket = async () => {
    if (!anchorWallet) {
      return;
    }

    console.log('refund');
    try {
      setIsMinting(true);
      await purchaseTicket(0, anchorWallet, fairLaunch);
      setIsMinting(false);
      setAlertState({
        open: true,
        message:
          'Congratulations! Funds withdrawn. This is an irreversible action.',
        severity: 'success',
      });
    } catch (e) {
      console.log(e);
      setIsMinting(false);
      setAlertState({
        open: true,
        message: 'Something went wrong.',
        severity: 'error',
      });
    }
  };

  const onPunchTicket = async () => {
    if (!anchorWallet || !fairLaunch || !fairLaunch.ticket) {
      return;
    }

    console.log('punch');
    setIsMinting(true);
    try {
      await punchTicket(anchorWallet, fairLaunch);
      setIsMinting(false);
      setAlertState({
        open: true,
        message: 'Congratulations! Ticket punched!',
        severity: 'success',
      });
    } catch (e) {
      console.log(e);
      setIsMinting(false);
      setAlertState({
        open: true,
        message: 'Something went wrong.',
        severity: 'error',
      });
    }
  };

  const candyMachinePredatesFairLaunch =
    candyMachine?.state.goLiveDate &&
    fairLaunch?.state.data.phaseTwoEnd &&
    candyMachine?.state.goLiveDate.lt(fairLaunch?.state.data.phaseTwoEnd);

  const notEnoughSOL = !!(
    yourSOLBalance != null &&
    fairLaunch?.state.data.priceRangeStart &&
    fairLaunch?.state.data.fee &&
    yourSOLBalance + (fairLaunch?.ticket?.data?.amount.toNumber() || 0) <
      contributed * LAMPORTS_PER_SOL +
        fairLaunch?.state.data.fee.toNumber() +
        0.01
  );

  return (
    <Container style={{ marginTop: 100 }}>
      {fairLaunch && (
        <AntiRug
          fairLaunch={fairLaunch}
          isMinting={[isMinting, setIsMinting]}
          setAlertState={setAlertState}
        />
      )}
      <Container maxWidth="xs" style={{ position: 'relative' }}>
        <Paper
          style={{ padding: 24, backgroundColor: '#151A1F', borderRadius: 6 }}
        >
          <Grid container justifyContent="center" direction="column">
            <PhaseHeader
              phase={phase}
              fairLaunch={fairLaunch}
              candyMachine={candyMachine}
              rpcUrl={rpcUrl}
              candyMachinePredatesFairLaunch={!!candyMachinePredatesFairLaunch}
            />
            {fairLaunch && (
              <Grid
                container
                direction="column"
                justifyContent="center"
                alignItems="center"
                style={{
                  height: 200,
                  marginTop: 20,
                  marginBottom: 20,
                  background: '#384457',
                  borderRadius: 6,
                }}
              >
                {fairLaunch.ticket.data ? (
                  <>
                    <Typography>Your bid</Typography>
                    <Typography variant="h6" style={{ fontWeight: 900 }}>
                      {formatNumber.format(
                        (fairLaunch?.ticket.data?.amount.toNumber() || 0) /
                          LAMPORTS_PER_SOL,
                      )}{' '}
                      SOL
                    </Typography>
                  </>
                ) : [Phase.AnticipationPhase, Phase.SetPrice].includes(
                    phase,
                  ) ? (
                  <Typography>
                    You haven't entered this raffle yet. <br />
                    {fairLaunch?.state?.data?.fee && (
                      <span>
                        <b>
                          All initial bids will incur a ◎{' '}
                          {fairLaunch?.state?.data?.fee.toNumber() /
                            LAMPORTS_PER_SOL}{' '}
                          fee.
                        </b>
                      </span>
                    )}
                  </Typography>
                ) : (
                  <Typography>
                    You didn't participate in this raffle.
                  </Typography>
                )}
              </Grid>
            )}

            {fairLaunch && (
              <>
                {[
                  Phase.SetPrice,
                  Phase.GracePeriod,
                  Phase.RaffleFinished,
                  Phase.Lottery,
                ].includes(phase) &&
                  fairLaunch?.ticket?.data?.state.withdrawn && (
                    <div style={{ paddingTop: '15px' }}>
                      <Alert severity="error">
                        Your bid was withdrawn and cannot be adjusted or
                        re-inserted.
                      </Alert>
                    </div>
                  )}
                {[Phase.GracePeriod].includes(phase) &&
                  fairLaunch.state.currentMedian &&
                  fairLaunch?.ticket?.data?.amount &&
                  !fairLaunch?.ticket?.data?.state.withdrawn &&
                  fairLaunch.state.currentMedian.gt(
                    fairLaunch?.ticket?.data?.amount,
                  ) && (
                    <div style={{ paddingTop: '15px' }}>
                      <Alert severity="warning">
                        Your bid is currently below the median and will not be
                        eligible for the raffle.
                      </Alert>
                    </div>
                  )}
                {[Phase.RaffleFinished, Phase.Lottery].includes(phase) &&
                  fairLaunch.state.currentMedian &&
                  fairLaunch?.ticket?.data?.amount &&
                  !fairLaunch?.ticket?.data?.state.withdrawn &&
                  fairLaunch.state.currentMedian.gt(
                    fairLaunch?.ticket?.data?.amount,
                  ) && (
                    <div style={{ paddingTop: '15px' }}>
                      <Alert severity="error">
                        Your bid was below the median and was not included in
                        the raffle. You may click <em>Withdraw</em> when the
                        raffle ends or you will be automatically issued one when
                        the Fair Launch authority withdraws from the treasury.
                      </Alert>
                    </div>
                  )}
                {notEnoughSOL && (
                  <Alert severity="error">
                    You do not have enough SOL in your account to place this
                    bid.
                  </Alert>
                )}
              </>
            )}

            {[Phase.SetPrice, Phase.GracePeriod].includes(phase) && (
              <>
                <Grid style={{ marginTop: 40, marginBottom: 20 }}>
                  {contributed > 0 ? (
                    <ValueSlider
                      min={min}
                      marks={marks}
                      max={max}
                      step={step}
                      value={contributed}
                      onChange={(ev, val) => setContributed(val as any)}
                      valueLabelDisplay="auto"
                      style={{
                        width: 'calc(100% - 40px)',
                        marginLeft: 20,
                        height: 30,
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                      }}
                    >
                      <CircularProgress />
                    </div>
                  )}
                </Grid>
              </>
            )}

            {!wallet.connected ? (
              <ConnectButton>
                Connect{' '}
                {[Phase.SetPrice].includes(phase) ? 'to bid' : 'to see status'}
              </ConnectButton>
            ) : (
              <div>
                {[Phase.SetPrice, Phase.GracePeriod].includes(phase) && (
                  <>
                    <CTAButton
                      onClick={onDeposit}
                      variant="contained"
                      disabled={
                        isMinting ||
                        (!fairLaunch?.ticket.data &&
                          phase === Phase.GracePeriod) ||
                        notEnoughSOL
                      }
                    >
                      {isMinting ? (
                        <CircularProgress />
                      ) : !fairLaunch?.ticket.data ? (
                        'Place bid'
                      ) : (
                        'Change bid'
                      )}
                      {}
                    </CTAButton>
                  </>
                )}

                {[Phase.RaffleFinished].includes(phase) && (
                  <>
                    {isWinner(fairLaunch) && (
                      <CTAButton
                        onClick={onPunchTicket}
                        variant="contained"
                        disabled={
                          fairLaunch?.ticket.data?.state.punched !== undefined
                        }
                      >
                        {isMinting ? <CircularProgress /> : 'Punch Ticket'}
                      </CTAButton>
                    )}

                    {!isWinner(fairLaunch) && (
                      <CTAButton
                        onClick={onRefundTicket}
                        variant="contained"
                        disabled={
                          isMinting ||
                          fairLaunch?.ticket.data === undefined ||
                          fairLaunch?.ticket.data?.state.withdrawn !== undefined
                        }
                      >
                        {isMinting ? <CircularProgress /> : 'Withdraw'}
                      </CTAButton>
                    )}
                  </>
                )}

                {rpcUrl === "https://api.devnet.solana.com" && (
                  <p>
                    This is an early access DevNet version of the
                    new year NFT minting lottery. Thanks for being
                    a good friend and a tester. Come back later for
                    the actual minting on MainNet
                  </p>
                )}

                {phase === Phase.Phase4 && (
                  <p>
                    For new year 2022, I wanted to experiment with
                    minting NFTs on Solana. This collection is a gift
                    I want to give to my close friends.
                  </p>
                )}

                {phase === Phase.Phase4 && (
                  <p>
                    You can mint as many NFTs as you'd like, but remeber,
                    there is only a limited amount.
                  </p>
                )}

                {phase === Phase.Phase4 && (
                  <>
                    {(!fairLaunch ||
                      isWinner(fairLaunch) ||
                      fairLaunchBalance > 0) && (
                      <MintContainer>
                        {candyMachine?.state.isActive &&
                        candyMachine?.state.gatekeeper &&
                        wallet.publicKey &&
                        wallet.signTransaction ? (
                          <GatewayProvider
                            wallet={{
                              publicKey:
                                wallet.publicKey ||
                                new PublicKey(CANDY_MACHINE_PROGRAM),
                              //@ts-ignore
                              signTransaction: wallet.signTransaction,
                            }}
                            // // Replace with following when added
                            // gatekeeperNetwork={candyMachine.state.gatekeeper_network}
                            gatekeeperNetwork={
                              candyMachine?.state?.gatekeeper?.gatekeeperNetwork
                            } // This is the ignite (captcha) network
                            /// Don't need this for mainnet
                            clusterUrl={rpcUrl}
                            options={{ autoShowModal: false }}
                          >
                            <MintButton
                              candyMachine={candyMachine}
                              fairLaunch={fairLaunch}
                              isMinting={isMinting}
                              fairLaunchBalance={fairLaunchBalance}
                              onMint={onMint}
                            />
                          </GatewayProvider>
                        ) : (
                          <MintButton
                            candyMachine={candyMachine}
                            fairLaunch={fairLaunch}
                            isMinting={isMinting}
                            fairLaunchBalance={fairLaunchBalance}
                            onMint={onMint}
                          />
                        )}
                      </MintContainer>
                    )}

                    {!(
                      !fairLaunch ||
                      isWinner(fairLaunch) ||
                      fairLaunchBalance > 0
                    ) && (
                      <CTAButton
                        onClick={onRefundTicket}
                        variant="contained"
                        disabled={
                          isMinting ||
                          fairLaunch?.ticket.data === undefined ||
                          fairLaunch?.ticket.data?.state.withdrawn !== undefined
                        }
                      >
                        {isMinting ? <CircularProgress /> : 'Withdraw'}
                      </CTAButton>
                    )}
                  </>
                )}
              </div>
            )}

            <Grid
              container
              justifyContent="space-between"
              color="textSecondary"
            >
              {fairLaunch && (
                <Link
                  component="button"
                  variant="body2"
                  color="textSecondary"
                  align="left"
                  onClick={() => {
                    setHowToOpen(true);
                  }}
                >
                  How this raffle works
                </Link>
              )}
              {fairLaunch?.ticket.data && (
                <Link
                  component="button"
                  variant="body2"
                  color="textSecondary"
                  align="right"
                  onClick={() => {
                    if (
                      !fairLaunch ||
                      phase === Phase.Lottery ||
                      isWinner(fairLaunch) ||
                      fairLaunchBalance > 0
                    ) {
                      setRefundExplainerOpen(true);
                    } else {
                      onRefundTicket();
                    }
                  }}
                >
                  Withdraw funds
                </Link>
              )}
            </Grid>
            <Dialog
              open={refundExplainerOpen}
              onClose={() => setRefundExplainerOpen(false)}
              PaperProps={{
                style: { backgroundColor: '#222933', borderRadius: 6 },
              }}
            >
              <MuiDialogContent style={{ padding: 24 }}>
                During raffle phases, or if you are a winner, or if this website
                is not configured to be a fair launch but simply a candy
                machine, refunds are disallowed.
              </MuiDialogContent>
            </Dialog>
            <Dialog
              open={howToOpen}
              onClose={() => setHowToOpen(false)}
              PaperProps={{
                style: { backgroundColor: '#222933', borderRadius: 6 },
              }}
            >
              <MuiDialogTitle
                disableTypography
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <Link
                  component="button"
                  variant="h6"
                  color="textSecondary"
                  onClick={() => {
                    setHowToOpen(true);
                  }}
                >
                  How it works
                </Link>
                <IconButton
                  aria-label="close"
                  className={dialogStyles.closeButton}
                  onClick={() => setHowToOpen(false)}
                >
                  <CloseIcon />
                </IconButton>
              </MuiDialogTitle>
              <MuiDialogContent>
                <Typography variant="h6">
                  Phase 1 - Set the fair price:
                </Typography>
                <Typography gutterBottom color="textSecondary">
                  Enter a bid in the range provided by the artist. The median of
                  all bids will be the "fair" price of the raffle ticket.{' '}
                  {fairLaunch?.state?.data?.fee && (
                    <span>
                      <b>
                        All bids will incur a ◎{' '}
                        {fairLaunch?.state?.data?.fee.toNumber() /
                          LAMPORTS_PER_SOL}{' '}
                        fee.
                      </b>
                    </span>
                  )}
                </Typography>
                <Typography variant="h6">Phase 2 - Grace period:</Typography>
                <Typography gutterBottom color="textSecondary">
                  If your bid was at or above the fair price, you automatically
                  get a raffle ticket at that price. There's nothing else you
                  need to do. Your excess SOL will be returned to you when the
                  Fair Launch authority withdraws from the treasury. If your bid
                  is below the median price, you can still opt in at the fair
                  price during this phase.
                </Typography>
                {candyMachinePredatesFairLaunch ? (
                  <>
                    <Typography variant="h6">
                      Phase 3 - The Candy Machine:
                    </Typography>
                    <Typography gutterBottom color="textSecondary">
                      Everyone who got a raffle ticket at the fair price is
                      entered to win an NFT. If you win an NFT, congrats. If you
                      don’t, no worries, your SOL will go right back into your
                      wallet.
                    </Typography>
                  </>
                ) : (
                  <>
                    <Typography variant="h6">Phase 3 - The Lottery:</Typography>
                    <Typography gutterBottom color="textSecondary">
                      Everyone who got a raffle ticket at the fair price is
                      entered to win a Fair Launch Token that entitles them to
                      an NFT at a later date using a Candy Machine here. If you
                      don’t win, no worries, your SOL will go right back into
                      your wallet.
                    </Typography>
                    <Typography variant="h6">
                      Phase 4 - The Candy Machine:
                    </Typography>
                    <Typography gutterBottom color="textSecondary">
                      On{' '}
                      {candyMachine?.state.goLiveDate
                        ? toDate(
                            candyMachine?.state.goLiveDate,
                          )?.toLocaleString()
                        : ' some later date'}
                      , you will be able to exchange your Fair Launch token for
                      an NFT using the Candy Machine at this site by pressing
                      the Mint Button.
                    </Typography>
                  </>
                )}
              </MuiDialogContent>
            </Dialog>

            {/* {wallet.connected && (
              <p>
                Address: {shortenAddress(wallet.publicKey?.toBase58() || '')}
              </p>
            )}

            {wallet.connected && (
              <p>Balance: {(balance || 0).toLocaleString()} SOL</p>
            )} */}
          </Grid>
        </Paper>
      </Container>

      {fairLaunch && (
        <Container
          maxWidth="xs"
          style={{ position: 'relative', marginTop: 10 }}
        >
          <div style={{ margin: 20 }}>
            <Grid container direction="row" wrap="nowrap">
              <Grid container md={4} direction="column">
                <Typography variant="body2" color="textSecondary">
                  Bids
                </Typography>
                <Typography
                  variant="h6"
                  color="textPrimary"
                  style={{ fontWeight: 'bold' }}
                >
                  {fairLaunch?.state.numberTicketsSold.toNumber() || 0}
                </Typography>
              </Grid>
              <Grid container md={4} direction="column">
                <Typography variant="body2" color="textSecondary">
                  Median bid
                </Typography>
                <Typography
                  variant="h6"
                  color="textPrimary"
                  style={{ fontWeight: 'bold' }}
                >
                  ◎{' '}
                  {phase === Phase.AnticipationPhase || phase === Phase.SetPrice
                    ? '???'
                    : formatNumber.format(median)}
                </Typography>
              </Grid>
              <Grid container md={4} direction="column">
                <Typography variant="body2" color="textSecondary">
                  Total raised
                </Typography>
                <Typography
                  variant="h6"
                  color="textPrimary"
                  style={{ fontWeight: 'bold' }}
                >
                  ◎{' '}
                  {formatNumber.format(
                    (fairLaunch?.treasury || 0) / LAMPORTS_PER_SOL,
                  )}
                </Typography>
              </Grid>
            </Grid>
          </div>
        </Container>
      )}
      <Snackbar
        open={alertState.open}
        autoHideDuration={6000}
        onClose={() => setAlertState({ ...alertState, open: false })}
      >
        <Alert
          onClose={() => setAlertState({ ...alertState, open: false })}
          severity={alertState.severity}
        >
          {alertState.message}
        </Alert>
      </Snackbar>
    </Container>
  );
};

export default Home;