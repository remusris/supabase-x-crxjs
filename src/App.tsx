import { useEffect, useState } from "react";
// import reactLogo from './assets/react.svg';
// import viteLogo from '/vite.svg';
// import SignIn from "./SignIn";

import type { User } from "@supabase/supabase-js";

// deal with all of this later

/* enum SCREEN {
  SIGN_IN,
  SIGN_UP,
  FACTS,
}

function App() {
  const [loading, setLoading] = useState(false);
  const [session, setSession] = useState(null);
  const [screen, setScreen] = useState(SCREEN.FACTS);
  const [error, setError] = useState("");

  async function getSession() {
    const {
      data: { session },
    } = await chrome.runtime.sendMessage({ action: "getSession" });
    setSession(session);
  }

  useEffect(() => {
    getSession();
  }, []);

  async function handleOnClick() {
    setLoading(true);
    setLoading(false);
  }

  async function handleSignUp(email: string, password: string) {
    await chrome.runtime.sendMessage({
      action: "signup",
      value: { email, password },
    });
    setScreen(SCREEN.SIGN_IN);
  }

  async function handleSignIn(email: string, password: string) {
    const { data, error } = await chrome.runtime.sendMessage({
      action: "signin",
      value: { email, password },
    });
    if (error) return setError(error.message);

    setSession(data.session);
  }

  async function handleSignOut() {
    const signOutResult = await chrome.runtime.sendMessage({
      action: "signout",
    });
    setScreen(SCREEN.SIGN_IN);
    setSession(signOutResult.data);
  }

  function renderApp() {
    if (!session) {
      if (screen === SCREEN.SIGN_UP) {
        return (
          <SignIn
            onSignIn={handleSignUp}
            title={"Sign Up"}
            onScreenChange={() => {
              setScreen(SCREEN.SIGN_IN);
              setError("");
            }}
            helpText={"Got an account? Sign in"}
            error={error}
          />
        );
      }
      return (
        <SignIn
          title="Sign In"
          onSignIn={handleSignIn}
          onScreenChange={() => {
            setScreen(SCREEN.SIGN_UP);
            setError("");
          }}
          helpText={"Create an account"}
          error={error}
        />
      );
    }

    return (
      <>
        <div>
          <a className="text-cyan-400" onClick={handleSignOut}>
            Sign out
          </a>
        </div>
      </>
    );
  }

  return (
    <div className="">
      <div className="flex flex-col gap-4 p-4 shadow-sm bg-gradient-to-r from-purple-100 to-blue-200 w-96 rounded-md">
        <h1>Cat Facts!</h1>
        {renderApp()}
      </div>
    </div>
  );
}

export default App;
 */

/* ------------------------------------------------------------------------------------ */

const chromeStorageKeys = {
  supabaseAccessToken: "supabaseAccessToken",
  supabaseRefreshToken: "supabaseRefreshToken",
  supabaseUserData: "supabaseUserData",
  supabaseExpiration: "supabaseExpiration",
};

function IndexOptions() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [expiration, setExpiration] = useState(0);
  const [user, setUser] = useState<User>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    chrome.storage.local.get(
      [
        chromeStorageKeys.supabaseAccessToken,
        chromeStorageKeys.supabaseExpiration,
        chromeStorageKeys.supabaseUserData,
      ],
      (result) => {
        if (result && result[chromeStorageKeys.supabaseAccessToken]) {
          const currentTime = Math.floor(Date.now() / 1000); // convert to seconds
          const timeUntilExpiration =
            result[chromeStorageKeys.supabaseExpiration] - currentTime;

          const refreshAndUpdate = () => {
            chrome.runtime.sendMessage({ action: "refresh" }, (response) => {
              if (response.error) {
                console.log("Error refreshing token: " + response.error);
              } else {
                if (response.data && response.data.session) {
                  console.log("Token refreshed successfully");
                  setUser(response.data.user);
                  setExpiration(response.data.session.expires_at);
                } else {
                  console.log("Error: session data is not available");
                }
              }
              setLoading(false); // Always stop loading, whether there was an error or not
            });
          };

          if (timeUntilExpiration <= 0) {
            // Token is expired, request a refresh and update user and expiration
            console.log("Session expired, refreshing token");
            refreshAndUpdate();
          } else {
            // Token is not expired, set user data and expiration
            setUser(result[chromeStorageKeys.supabaseUserData]);
            setExpiration(result[chromeStorageKeys.supabaseExpiration]);

            if (timeUntilExpiration < 24 * 60 * 60) {
              // less than 24 hours left, request a refresh and update user and expiration
              console.log("Token is about to expire, refreshing token");
              refreshAndUpdate();
            } else {
              setLoading(false); // Add this line
            }
          }
        } else {
          setLoading(false); // Add this line
        }
      }
    );
  }, []);

  async function handleLogin(username: string, password: string) {
    try {
      // Send a message to the background script to initiate the login
      chrome.runtime.sendMessage(
        { action: "signin", value: { email: username, password: password } },
        (response) => {
          if (response.error) {
            alert("Error with auth: " + response.error.message);
          } else if (response.data?.user) {
            setUser(response.data.user);
            setExpiration(response.data.session.expires_at);
          }
        }
      );
    } catch (error) {
      console.log("error", error);
      alert(error.error_description || error);
    }
  }

  async function handleSignup(username: string, password: string) {
    try {
      // Send a message to the background script to initiate the signup
      chrome.runtime.sendMessage(
        { action: "signup", value: { email: username, password: password } },
        (response) => {
          if (response.error) {
            alert("Error with auth: " + response.error.message);
          } else if (response.data?.user) {
            alert("Signup successful, confirmation mail should be sent soon!");
          }
        }
      );
    } catch (error) {
      console.log("error", error);
      alert(error.error_description || error);
    }
  }

  async function handleSignout() {
    try {
      // Send a message to the background script to initiate the signout
      chrome.runtime.sendMessage(
        { action: "signout", value: null },
        (response) => {
          if (response.error) {
            alert("Error signing out: " + response.error.message);
          } else {
            setUser(null);
            setExpiration(0);
          }
        }
      );
    } catch (error) {
      console.log("error", error);
      alert(error.error_description || error);
    }
  }

  async function handleRefresh() {
    try {
      // Send a message to the background script to refresh the session
      chrome.runtime.sendMessage(
        { action: "refresh", value: null },
        (response) => {
          if (response.error) {
            console.log("Error refreshing token: " + response.error.message);
          } else {
            console.log("Token refreshed successfully");
            setUser(response.data.user);
            setExpiration(response.data.session.expires_at);
          }
        }
      );
    } catch (error) {
      console.log("error", error);
      alert(error.error_description || error);
    }
  }

  return (
    <div className="flex flex-col items-center p-4 bg-gradient-to-r from-blue-100 to-blue-200 text-slate-800 w-full">
      <h1 className="text-2xl font-bold mb-4">MemoryLink</h1>
      {loading ? (
        <div>Loading...</div>
      ) : user ? (
        <>
          <div className="mb-4">
            <p>
              {user.email} - {user.id}
            </p>
            <p className="mb-4">
              Token Expiration: {new Date(expiration * 1000).toLocaleString()}
            </p>
            <div className="flex justify-around w-full">
              <button
                className="px-4 py-2 font-semibold bg-blue-500 text-white rounded-full shadow-sm opacity-100 w-40"
                onClick={handleSignout}
              >
                Sign out
              </button>
              <button
                className="px-4 py-2 font-semibold bg-blue-500 text-white rounded-full shadow-sm opacity-100 w-40"
                onClick={handleRefresh}
              >
                Refresh Token
              </button>
            </div>
          </div>
        </>
      ) : (
        <form
          className="flex flex-col items-center justify-start gap-y-6 w-full"
          onSubmit={(e) => {
            e.preventDefault();
            handleLogin(username, password);
          }}
        >
          <label className="block w-full">
            <span className="text-slate-700 dark:text-slate-400">Email</span>
            <input
              required
              placeholder="jane@acme.com"
              type="email"
              className="mt-1 block w-full border-gray-300 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50 form-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label className="block w-full">
            <span className="text-slate-700 dark:text-slate-400">Password</span>
            <input
              required
              type="password"
              className="mt-1 block w-full border-gray-300 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50 form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <div className="flex justify-around w-full">
            <button
              type="submit"
              className="px-4 py-2 font-semibold bg-blue-500 text-white rounded-full shadow-sm opacity-100 w-40"
            >
              Login
            </button>
            <button
              onClick={(e) => {
                e.preventDefault();
                handleSignup(username, password);
              }}
              className="px-4 py-2 font-semibold bg-blue-500 text-white rounded-full shadow-sm opacity-100 w-40"
            >
              Sign up
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default IndexOptions;

/* -------------------------------------------------------------------------------------------- */
