import React, { useState } from 'react';
import FeedbackModal from './FeedbackModal';

type FeedbackButtonProps = {
  userEmail?: string;
};

export default function FeedbackButton({ userEmail }: FeedbackButtonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsModalOpen(true)}
        className="px-4 py-2 bg-purple-800 text-stone-100 text-sm font-semibold rounded-full hover:bg-purple-900 shadow-md transition-all"
        title="Send Feedback"
      >
        Feedback
      </button>

      <FeedbackModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        userEmail={userEmail}
      />
    </>
  );
}
