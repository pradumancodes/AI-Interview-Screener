/* eslint-disable @typescript-eslint/no-unused-vars */
import { useAuth } from "@clerk/clerk-react";
import {
  CircleStop,
  Loader,
  Mic,
  RefreshCw,
  Save,
  Video,
  VideoOff,
  WebcamIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import useSpeechToText, { ResultType } from "react-hook-speech-to-text";
import { useParams } from "react-router-dom";
import WebCam from "react-webcam";
import { TooltipButton } from "./tooltip-button";
import { toast } from "sonner";
import { chatSession } from "@/scripts";
import { SaveModal } from "./save-modal";
import {
  addDoc,
  collection,
  getDocs,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { db } from "@/config/firebase.config";

interface RecordAnswerProps {
  question: { question: string; answer: string };
  isWebCam: boolean;
  setIsWebCam: (value: boolean) => void;
}

interface AIResponse {
  ratings: number;
  feedback: string;
}

export const RecordAnswer = ({
  question,
  isWebCam,
  setIsWebCam,
}: RecordAnswerProps) => {
  const {
    interimResult,
    isRecording,
    results,
    startSpeechToText,
    stopSpeechToText,
  } = useSpeechToText({
    continuous: true,
    useLegacyResults: false,
  });

  const [userAnswer, setUserAnswer] = useState("");
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [aiResult, setAiResult] = useState<AIResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const { userId } = useAuth();
  const { interviewId } = useParams();

  const recordUserAnswer = async () => {
    if (isRecording) {
      stopSpeechToText();

      if (userAnswer?.length < 30) {
        toast.error("Your answer should be more than 30 characters.");
        return;
      }

      const aiResult = await generateResult(
        question.question,
        question.answer,
        userAnswer
      );

      setAiResult(aiResult);
    } else {
      startSpeechToText();
    }
  };

  const cleanJsonResponse = (responseText: string) => {
    let cleanText = responseText.trim();
    cleanText = cleanText.replace(/(json|```|`)/gi, "");
    return JSON.parse(cleanText);
  };

  const generateResult = async (
    qst: string,
    qstAns: string,
    userAns: string
  ): Promise<AIResponse> => {
    setIsAiGenerating(true);
    const prompt = `
      Question: "${qst}"
      User Answer: "${userAns}"
      Correct Answer: "${qstAns}"
      Please compare the user's answer to the correct answer, and provide a rating (1 to 10), and feedback for improvement.
      Return this in JSON format:
      {
        "ratings": number,
        "feedback": string
      }
    `;

    try {
      const aiResult = await chatSession.sendMessage(prompt);
      const parsed: AIResponse = cleanJsonResponse(aiResult.response.text());
      return parsed;
    } catch (error) {
      console.log(error);
      toast.error("Failed to get feedback from AI.");
      return { ratings: 0, feedback: "Unable to generate feedback." };
    } finally {
      setIsAiGenerating(false);
    }
  };

  const recordNewAnswer = () => {
    setUserAnswer("");
    setAiResult(null);
    stopSpeechToText();
    startSpeechToText();
  };

  const saveUserAnswer = async () => {
    setLoading(true);

    if (!aiResult) return;

    const currentQuestion = question.question;
    try {
      const userAnswerQuery = query(
        collection(db, "userAnswers"),
        where("userId", "==", userId),
        where("question", "==", currentQuestion)
      );

      const querySnap = await getDocs(userAnswerQuery);

      if (!querySnap.empty) {
        toast.info("Already Answered", {
          description: "You have already answered this question.",
        });
        return;
      }

      await addDoc(collection(db, "userAnswers"), {
        mockIdRef: interviewId,
        question: question.question,
        correct_ans: question.answer,
        user_ans: userAnswer,
        feedback: aiResult.feedback,
        rating: aiResult.ratings,
        userId,
        createdAt: serverTimestamp(),
      });

      toast.success("Answer saved successfully.");
      setUserAnswer("");
      setAiResult(null);
      stopSpeechToText();
    } catch (error) {
      toast.error("Failed to save answer.");
      console.error(error);
    } finally {
      setLoading(false);
      setOpen(false);
    }
  };

  useEffect(() => {
    const combineTranscripts = results
      .filter((result): result is ResultType => typeof result !== "string")
      .map((result) => result.transcript)
      .join(" ");
    setUserAnswer(combineTranscripts);
  }, [results]);

  return (
    <div className="w-full flex flex-col items-center gap-8 mt-4">
      <SaveModal
        isOpen={open}
        onClose={() => setOpen(false)}
        onConfirm={saveUserAnswer}
        loading={loading}
      />

      <div className="w-full h-[400px] md:w-96 flex flex-col items-center justify-center border p-4 bg-gray-50 rounded-md">
        {isWebCam ? (
          <WebCam
            onUserMedia={() => setIsWebCam(true)}
            onUserMediaError={() => setIsWebCam(false)}
            className="w-full h-full object-cover rounded-md"
          />
        ) : (
          <WebcamIcon className="min-w-24 min-h-24 text-muted-foreground" />
        )}
      </div>

      <div className="flex justify-center gap-3">
        <TooltipButton
          content={isWebCam ? "Turn Off" : "Turn On"}
          icon={isWebCam ? <VideoOff /> : <Video />}
          onClick={() => setIsWebCam(!isWebCam)}
        />

        <TooltipButton
          content={isRecording ? "Stop Recording" : "Start Recording"}
          icon={isRecording ? <CircleStop /> : <Mic />}
          onClick={recordUserAnswer}
        />

        <TooltipButton
          content="Record Again"
          icon={<RefreshCw />}
          onClick={recordNewAnswer}
        />

        <TooltipButton
          content="Save Result"
          icon={
            isAiGenerating ? (
              <Loader className="animate-spin" />
            ) : (
              <Save />
            )
          }
          onClick={() => setOpen(true)}
          disbaled={!aiResult}
        />
      </div>

      <div className="w-full mt-4 p-4 border rounded-md bg-gray-50">
        <h2 className="text-lg font-semibold">Your Answer:</h2>
        <p className="text-sm mt-2 text-gray-700">
          {userAnswer || "Start recording to see your answer here."}
        </p>
        {interimResult && (
          <p className="text-sm text-gray-500 mt-2">
            <strong>Current Speech:</strong> {interimResult}
          </p>
        )}
      </div>

      {aiResult && (
        <div className="w-full mt-4 p-4 border rounded-md bg-green-50">
          <h2 className="text-lg font-semibold text-green-800">AI Feedback</h2>
          <p className="text-sm mt-2 text-green-700">
            <strong>Rating:</strong> {aiResult.ratings}/10
          </p>
          <p className="text-sm mt-1 text-green-700">
            <strong>Feedback:</strong> {aiResult.feedback}
          </p>
        </div>
      )}
    </div>
  );
};
