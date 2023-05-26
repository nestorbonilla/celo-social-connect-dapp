import Image from "next/image";
import { AiFillTwitterCircle } from "react-icons/ai";

export default function SessionCard({session}: {session: any}) {
  return (
    <div className="flex flex-col relative items-center bg-white border border-onyx shadow md:flex-row">
      <div className="absolute top-3 right-3">
        <AiFillTwitterCircle className="w-8 h-8" />
      </div>
      <Image
        className="object-cover w-full h-96 md:h-auto md:w-48"
        src={session.user?.image}
        alt={session.user?.name}
        width={100}
        height={100}
      />
      <div className="flex flex-col justify-between p-4">
          <h5 className="mb-2 text-2xl font-bold text-onyx">
            {session.username}
          </h5>
          <ul>
            <li>Name: {session.user?.name}</li>
            <li>Session expiration: {new Date(session.expires).toDateString()}</li>
          </ul>
      </div>
    </div>
  )
}