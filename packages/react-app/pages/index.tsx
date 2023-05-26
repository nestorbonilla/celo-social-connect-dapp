import {
  ALFAJORES_CUSD_ADDRESS,
  ALFAJORES_RPC,
  FA_CONTRACT,
  FA_PROXY_ADDRESS,
  ODIS_PAYMENTS_CONTRACT,
  ODIS_PAYMENTS_PROXY_ADDRESS,
  STABLE_TOKEN_CONTRACT,
  ISSUER_PRIVATE_KEY,
  DEK_PRIVATE_KEY
} from "../utils/constants";
import { OdisUtils } from "@celo/identity";
import { AuthenticationMethod, AuthSigner, OdisContextName } from "@celo/identity/lib/odis/query";
import { ethers, Wallet } from "ethers";
import { WebBlsBlindingClient } from "../utils/webBlindingClient";
import { parseEther } from "viem";
import { useSession, signIn, signOut } from "next-auth/react";
import { LockOpenIcon, LockClosedIcon } from "@heroicons/react/24/outline";
import { useAccount, useSendTransaction } from "wagmi";
import { ISocialConnect } from "@/utils/ISocialConnect";
import { useIsMounted } from "@/hooks/useIsMounted";
import { useEffect, useState } from "react";
import SessionCard from "@/components/SessionCard";

export default function Home() {

  let isMounted = useIsMounted();

  let [sc, setSc] = useState<ISocialConnect>();

  // step no. 1
  let { address } = useAccount();

  // step no. 2
  let { data: session } = useSession();
  let [socialIdentifier, setSocialIdentifier] = useState("");

  // step no. 3
  let [identifierToSend, setIdentifierToSend] = useState("");
  let [addressToSend, setAddressToSend] = useState("");

  useEffect(() => {

    let provider = new ethers.providers.JsonRpcProvider(ALFAJORES_RPC);
    let issuer = new Wallet(ISSUER_PRIVATE_KEY!, provider);
    let serviceContext = OdisUtils.Query.getServiceContext(OdisContextName.ALFAJORES);
    let blindingClient = new WebBlsBlindingClient(serviceContext.odisPubKey);
    let quotaFee = ethers.utils.parseEther("0.01");
    let authSigner: AuthSigner = {
      authenticationMethod: AuthenticationMethod.ENCRYPTION_KEY,
      rawKey: DEK_PRIVATE_KEY!
    };
    let federatedAttestationsContract = new ethers.Contract(
      FA_PROXY_ADDRESS!,
      FA_CONTRACT.abi,
      issuer
    );
    let odisPaymentsContract = new ethers.Contract(
      ODIS_PAYMENTS_PROXY_ADDRESS!,
      ODIS_PAYMENTS_CONTRACT.abi,
      issuer
    );
    let stableTokenContract = new ethers.Contract(
      ALFAJORES_CUSD_ADDRESS!,
      STABLE_TOKEN_CONTRACT.abi,
      issuer
    );
    let sCVars : ISocialConnect = {
      issuerAddress: issuer.address,
      federatedAttestationsContract,
      odisPaymentsContract,
      stableTokenContract,
      authSigner,
      serviceContext,
      quotaFee,
      blindingClient
    };
    setSc(sCVars);
  }, []);

  useEffect(() => {
    // @ts-ignore: session was customized
    session && session?.username && setSocialIdentifier(session?.username);
  }, [session]);

  let { sendTransaction } = useSendTransaction({
    to: addressToSend,
    value: parseEther("0.1", "wei")
  });

  let steps = [
    {
      id: 1,
      content: "User connection",
      active: !!address,
    },
    {
      id: 2,
      content: "Verify identifier ownership",
      active: !!session,
    },
    {
      id: 3,
      content: "Map identifier with connected address",
      active: !!address && !!session,
    },
    {
      id: 4,
      content: "Send value through identifier",
      active: !!address && !!addressToSend,
    },
    {
      id: 5,
      content: "De-register identifier from address",
      active: !!address && !!session,
    },
  ];

  let identifierLogin = () => {
    if (session) {
      return (
        <>
          <SessionCard session={session} />
          <button
            type="button"
            className="inline-flex self-center items-center rounded-full border border-wood bg-prosperity py-2 px-5 my-5 text-md font-medium text-black hover:bg-snow"
            onClick={() => {signOut()}}>
              Sign out
            </button>
        </>
      )
    }
    return (
      <>
        <button
          type="button"
          className="inline-flex self-center items-center rounded-full border border-wood bg-prosperity py-2 px-5 my-5 text-md font-medium text-black hover:bg-snow"
          onClick={() => signIn()}>
            Sign in
          </button>
      </>
    )
  }

  async function checkAndTopUpODISQuota() {
    const { remainingQuota } = await OdisUtils.Quota.getPnpQuotaStatus(
      sc!.issuerAddress,
      sc!.authSigner,
      sc!.serviceContext
    );
    if (remainingQuota < 1) {
      let currentAllowance = await sc!.stableTokenContract.allowance(
        sc!.issuerAddress,
        sc!.odisPaymentsContract.address
      );
      let enoughAllowance = false;
      if (sc!.quotaFee.gt(currentAllowance)) {
        let approvalTxReceipt = await sc!.stableTokenContract
          .increaseAllowance(
            sc!.odisPaymentsContract.address,
            sc!.quotaFee
          );
        enoughAllowance = approvalTxReceipt.status;
      } else {
        enoughAllowance = true;
      }
      if (enoughAllowance) {
        let odisPayment = await sc!.odisPaymentsContract
          .payInCUSD(
            sc!.issuerAddress,
            sc!.quotaFee
          );
      } else {
        throw "ODIS => cUSD approval failed";
      }
    }
  }
  
  async function getObfuscatedIdentifier(identifier: string) {
    let obfuscatedIdentifier = (
      await OdisUtils.Identifier.getObfuscatedIdentifier(
        identifier,
        OdisUtils.Identifier.IdentifierPrefix.TWITTER,
        sc!.issuerAddress,
        sc!.authSigner,
        sc!.serviceContext,
        undefined,
        undefined,
        sc!.blindingClient
      )
    ).obfuscatedIdentifier;
    return obfuscatedIdentifier;
  }

  async function registerAttestation(identifier: string, account: string) {
    // check and top up ODIS quota
    await checkAndTopUpODISQuota();
    let nowTimestamp = Math.floor(new Date().getTime() / 1000);
    let obfuscatedIdentifier = getObfuscatedIdentifier(identifier);
    await sc!.federatedAttestationsContract.registerAttestationAsIssuer(
      obfuscatedIdentifier,
      account,
      nowTimestamp
    );
    alert("Address mapped.");
  }

  async function lookupAddress() {
    let obfuscatedIdentifier = getObfuscatedIdentifier(socialIdentifier);
    let attestations = await sc!.federatedAttestationsContract.lookupAttestations(
      obfuscatedIdentifier,
      [sc!.issuerAddress]
    );
    let [latestAddress] = attestations.accounts;
    setAddressToSend(latestAddress);
  }

  async function deregisterIdentifier(identifier: string) {
    try {
      let obfuscatedIdentifier = getObfuscatedIdentifier(identifier);
      await sc!.federatedAttestationsContract
        .revokeAttestation(obfuscatedIdentifier, sc!.issuerAddress, address);
        alert("Address de-registered.");
    } catch (error) {
      
    }
  }

  if (!isMounted) return null;

  return (
    <main>
    <div className="flow-root">
        <ul role="list" className="mb-8">
            {steps.map((step, stepIdx) => (
                <li key={step.id}>
                    <div className="relative pb-8">
                        {stepIdx !== steps.length - 1 ? (
                            <span
                                className="absolute top-4 left-4 -ml-px h-full w-0.5 bg-onyx"
                                aria-hidden="true"
                            />
                        ) : null}
                        <div className="relative flex space-x-3">
                            <div>
                                <span
                                    className={ step.active ? "bg-forest h-8 w-8 flex items-center justify-center ring-1 ring-onyx" : "bg-gypsum h-8 w-8 flex items-center justify-center ring-1 ring-onyx"}
                                >
                                    {step.active && (
                                        <LockOpenIcon
                                            className="h-5 w-5 text-snow"
                                            aria-hidden="true"
                                        />
                                    )}
                                    {!step.active && (
                                        <LockClosedIcon
                                            className="h-5 w-5 text-onyx"
                                            aria-hidden="true"
                                        />
                                    )}
                                </span>
                            </div>
                            <div className="flex min-w-0 flex-1 justify-between space-x-4 pt-1.5">
                                <div>
                                    <p className="text-xl text-onyx">
                                        {step.content}
                                    </p>
                                </div>
                            </div>
                        </div>
                        <div className="pl-11 pt-4">
                            {step.id == 1 && address && (
                                <>
                                    <p className="flex flex-col mx-auto content-center">
                                        User connected.
                                    </p>
                                    <div className="italic text-forest">
                                        <p>{address}</p>
                                    </div>
                                </>
                            )}
                            {step.id == 1 && !address && (
                                <>
                                    <p className="flex flex-col mx-auto content-center">
                                        User not connected.
                                    </p>
                                </>
                            )}
                            {step.id == 2 && <>{identifierLogin()}</>}
                            {step.id == 3 && (
                              <div className="bg-white py-8 px-4 border border-onyx sm:px-10">
                                  <form
                                      className="space-y-6"
                                      onSubmit={(event) => {
                                          event.preventDefault();
                                          registerAttestation(
                                              socialIdentifier,
                                              address!
                                          );
                                      }}
                                  >
                                      <div>
                                          <label
                                              htmlFor="address"
                                              className="block text-sm font-medium text-onyx"
                                          >
                                              Address (public key)
                                          </label>
                                          <div className="mt-1">
                                              <input
                                                  id="address"
                                                  name="address"
                                                  type="text"
                                                  autoComplete="address"
                                                  required
                                                  value={address}
                                                  disabled={true}
                                                  className="block w-full appearance-none border border-onyx px-3 py-2 bg-gypsum text-wood focus:border-forest focus:outline-none focus:ring-forest sm:text-sm"
                                              />
                                          </div>
                                      </div>

                                      <div>
                                          <label
                                              htmlFor="identifierType"
                                              className="block text-sm font-medium text-onyx"
                                          >
                                              Identifier type
                                          </label>
                                          <div className="mt-1">
                                              <input
                                                  id="identifierType"
                                                  name="identifierType"
                                                  type="text"
                                                  autoComplete="identifierType"
                                                  required
                                                  value={"GitHub"}
                                                  disabled={true}
                                                  className="block w-full appearance-none border border-onyx px-3 py-2 bg-gypsum text-wood focus:border-forest focus:outline-none focus:ring-forest sm:text-sm"
                                              />
                                          </div>
                                      </div>

                                      <div>
                                          <label
                                              htmlFor="identifier"
                                              className="block text-sm font-medium text-onyx"
                                          >
                                              Identifier
                                          </label>
                                          <div className="mt-1">
                                              <input
                                                  id="identifier"
                                                  name="identifier"
                                                  type="text"
                                                  autoComplete="identifier"
                                                  required
                                                  value={
                                                    socialIdentifier
                                                  }
                                                  disabled={true}
                                                  className="block w-full appearance-none border border-onyx px-3 py-2 bg-gypsum text-wood focus:border-forest focus:outline-none focus:ring-forest sm:text-sm"
                                              />
                                          </div>
                                      </div>

                                      <div className="flex flex-col mx-auto content-center">
                                          <button
                                            type={"submit"}
                                            className="inline-flex self-center items-center rounded-full border border-wood bg-prosperity py-2 px-5 my-5 text-md font-medium text-black hover:bg-snow">
                                              Register
                                          </button>
                                      </div>
                                  </form>
                              </div>
                            )}
                            {step.id == 4 && (
                              <div className="bg-white py-8 px-4 border border-onyx sm:px-10">
                                  <form className="space-y-6">
                                      <div>
                                          <label
                                              htmlFor="identifierType"
                                              className="block text-sm font-medium text-onyx"
                                          >
                                              Recipient Identifier type
                                          </label>
                                          <div className="mt-1">
                                              <input
                                                  id="identifierType"
                                                  name="identifierType"
                                                  type="text"
                                                  autoComplete="identifierType"
                                                  required
                                                  value={"Twitter"}
                                                  disabled={true}
                                                  className="block w-full appearance-none border border-onyx px-3 py-2 bg-gypsum text-wood focus:border-forest focus:outline-none focus:ring-forest sm:text-sm"
                                              />
                                          </div>
                                      </div>

                                      <div>
                                          <label
                                              htmlFor="identifier"
                                              className="block text-sm font-medium text-onyx"
                                          >
                                              Recipient Identifier
                                          </label>
                                          <div className="mt-1">
                                              <input
                                                  id="identifier"
                                                  name="identifier"
                                                  type="text"
                                                  autoComplete="identifier"
                                                  required
                                                  value={
                                                    identifierToSend
                                                  }
                                                  onChange={(
                                                    e: React.ChangeEvent<HTMLInputElement>
                                                  ) => {
                                                      setIdentifierToSend(e.target.value);
                                                  }}
                                                  className="block w-full appearance-none border border-onyx px-3 py-2 bg-gypsum text-wood focus:border-forest focus:outline-none focus:ring-forest sm:text-sm"
                                              />
                                          </div>
                                      </div>

                                      <div>
                                          <label
                                              htmlFor="address"
                                              className="block text-sm font-medium text-onyx"
                                          >
                                              Recipient Address (resolution)
                                          </label>
                                          <div className="mt-1">
                                              <input
                                                  id="address"
                                                  name="address"
                                                  type="text"
                                                  autoComplete="address"
                                                  value={addressToSend}
                                                  disabled
                                                  className="block w-full appearance-none border border-onyx px-3 py-2 bg-gypsum text-wood focus:border-forest focus:outline-none focus:ring-forest sm:text-sm"
                                              />
                                          </div>
                                      </div>

                                      <div>
                                          <label
                                              htmlFor="address"
                                              className="block text-sm font-medium text-onyx"
                                          >
                                              From Address (user)
                                          </label>
                                          <div className="mt-1">
                                              <input
                                                  id="address"
                                                  name="address"
                                                  type="text"
                                                  autoComplete="address"
                                                  required
                                                  value={address}
                                                  disabled
                                                  className="block w-full appearance-none border border-onyx px-3 py-2 bg-gypsum text-wood focus:border-forest focus:outline-none focus:ring-forest sm:text-sm"
                                              />
                                          </div>
                                      </div>
                                      
                                      <div className="flex col-span-2 mx-auto content-center">
                                          <button
                                            type={"button"}
                                            disabled={false}
                                            onClick={() => { lookupAddress(); }}
                                            className="w-1/3 inline-flex self-center items-center rounded-full border border-wood bg-prosperity py-2 px-5 my-5 text-md font-medium text-black hover:bg-snow disabled:bg-snow disabled:text-gray-300">
                                              Search
                                          </button>
                                          <div className="w-1/3"/>
                                          <button
                                            type={"button"}
                                            disabled={ !addressToSend }
                                            onClick={() => { sendTransaction(); }}
                                            className="w-1/3 inline-flex self-center items-center rounded-full border border-wood bg-prosperity py-2 px-5 my-5 text-md font-medium text-black hover:bg-snow disabled:bg-snow disabled:text-gray-300">
                                              Send
                                          </button>
                                      </div>
                                  </form>
                              </div>
                            )}
                            {step.id == 5 && address && (
                              <div className="bg-white py-8 px-4 border border-onyx sm:px-10">
                                  <form
                                      className="space-y-6"
                                      onSubmit={(event) => {
                                          event.preventDefault();
                                          deregisterIdentifier(
                                            socialIdentifier
                                          );
                                      }}
                                  >
                                      <div>
                                          <label
                                              htmlFor="identifierType"
                                              className="block text-sm font-medium text-onyx"
                                          >
                                              Identifier type
                                          </label>
                                          <div className="mt-1">
                                              <input
                                                  id="identifierType"
                                                  name="identifierType"
                                                  type="text"
                                                  autoComplete="identifierType"
                                                  required
                                                  value={"GitHub"}
                                                  disabled={true}
                                                  className="block w-full appearance-none border border-onyx px-3 py-2 bg-gypsum text-wood focus:border-forest focus:outline-none focus:ring-forest sm:text-sm"
                                              />
                                          </div>
                                      </div>

                                      <div>
                                          <label
                                              htmlFor="identifier"
                                              className="block text-sm font-medium text-onyx"
                                          >
                                              Identifier
                                          </label>
                                          <div className="mt-1">
                                              <input
                                                  id="identifier"
                                                  name="identifier"
                                                  type="text"
                                                  autoComplete="identifier"
                                                  required
                                                  value={
                                                    socialIdentifier
                                                  }
                                                  disabled={true}
                                                  className="block w-full appearance-none border border-onyx px-3 py-2 bg-gypsum text-wood focus:border-forest focus:outline-none focus:ring-forest sm:text-sm"
                                              />
                                          </div>
                                      </div>

                                      <div>
                                          <label
                                              htmlFor="address"
                                              className="block text-sm font-medium text-onyx"
                                          >
                                              Address (public key)
                                          </label>
                                          <div className="mt-1">
                                              <input
                                                  id="address"
                                                  name="address"
                                                  type="text"
                                                  autoComplete="address"
                                                  required
                                                  value={address}
                                                  disabled={true}
                                                  className="block w-full appearance-none border border-onyx px-3 py-2 bg-gypsum text-wood focus:border-forest focus:outline-none focus:ring-forest sm:text-sm"
                                              />
                                          </div>
                                      </div>

                                      <div className="flex flex-col mx-auto content-center">
                                          <button
                                            type={"submit"}
                                            disabled={ !socialIdentifier && !address }
                                            className="inline-flex self-center items-center rounded-full border border-wood bg-prosperity py-2 px-5 my-5 text-md font-medium text-black hover:bg-snow disabled:bg-snow disabled:text-gray-300">
                                              De-register
                                          </button>
                                      </div>
                                  </form>
                              </div>
                            )}
                        </div>
                    </div>
                </li>
            ))}
        </ul>
    </div>
  </main>
  )
}
