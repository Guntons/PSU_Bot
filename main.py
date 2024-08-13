import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from string import punctuation
from typing import Any, Final

try:
    # 3.11+
    from typing import Self
except ImportError:
    from typing_extensions import Self

import Levenshtein
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from sqlalchemy import (Column, Engine, ForeignKey, Integer, String,
                        create_engine, select)
from sqlalchemy.orm import DeclarativeBase, sessionmaker

# levenshtein ratio from which two words are considered to be the same
SCORE_CUTOFF: Final[float] = 0.8
# maximum amount of question matches to send in response
MATCHES_LIMIT: Final[int] = 10
# path to images used in db
DB_PICTURES_PATH: Final[str] = "./images/db/"

app: Final[FastAPI] = FastAPI()
DB_ENGINE: Final[Engine] = create_engine("sqlite:///db.sqlite3")
DBSESSION: Final = sessionmaker(DB_ENGINE)


class Base(DeclarativeBase):
    ...


class QuestionGroup(Base):
    __tablename__ = "question_groups"

    id = Column(Integer, primary_key=True, unique=True, autoincrement=True)
    name = Column(String, unique=True)


class Question(Base):
    __tablename__ = "questions"

    id = Column(Integer, primary_key=True, unique=True, autoincrement=True)
    question_group = Column(Integer, ForeignKey("question_groups.id"))
    question = Column(String, unique=True)
    answer = Column(String)
    # divide links with ;
    pictures_links = Column(String, nullable=True)


async def get_questions() -> list[str]:
    """Gets all questions from db

    Returns:
        list[str]: list with questions
    """
    questions = []
    with DBSESSION() as session:
        stmt = select(Question)
        for question in session.scalars(stmt):
            questions.append(question.question)
    return questions


async def get_answer(question: str) -> tuple[str, list[str]]:
    """Gets answer for given question from db

    Args:
        question (str): question to get answer for

    Raises:
        ValueError: raised if no such question in db

    Returns:
        tuple[str, list[str]]: (answer in text form, links to pictures)
    """
    with DBSESSION() as session:
        stmt = select(Question).where(Question.question == question)
        db_question = session.scalar(stmt)
        if db_question is None:
            raise ValueError(f"No question {question} in db")
        return str(db_question.answer), db_question.pictures_links.split(";") if db_question.pictures_links is not None else []


async def split(question: str) -> list[str]:
    """Splits a string into words

    Args:
        question (str): string to be split

    Returns:
        list[str]: list of all words in string
    """
    # remove all punctuation and make all letters lowercase
    for char in punctuation:
        question = question.replace(char, "")
    question = question.lower()
    # в список не добавляются все слова, в которых меньше 3 букв, в основном это предлоги, союзы и частицы, а так же вопросительные слова
    words = []
    for word in question.split():
        if len(word) > 2 or word.isdecimal():
            words.append(word)

    return words


async def get_question_matches(user_input: str, questions: list[str]) -> list[tuple[str, int]]:
    """Gets how many words in user_input match each question

    Args:
        user_input (str): string words from which will be matched against questions
        questions (list[str]): words from user_input will be matched against questions from this list

    Returns:
        list[tuple[str, int]]: list of tuples where first element is question and second is number of matches with user_input of this question, only contains questions which have at least 1 match, sorted by matches from bigger to smaller
    """
    user_words = await split(user_input)
    matches = []
    for question in questions:
        question_words = await split(question)
        matches_number = 0
        for question_word in question_words:
            for user_word in user_words:
                if Levenshtein.ratio(question_word, user_word, score_cutoff=SCORE_CUTOFF):
                    matches_number += 1
        if matches_number > 0:
            matches.append((question, matches_number))
    matches.sort(key=lambda x: x[1], reverse=True)

    return matches


async def linkify(string: str) -> str:
    """Replaces urls with <a> tags with respective url

    Args:
        string (str): string to linkify

    Returns:
        str: string with replaced urls
    """
    # url pattern (hopefully)
    pattern = r"[(http(s)?):\/\/(www\.)?a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)"
    for match in re.finditer(pattern, string):
        link = string[match.start():match.end()]
        string = f"{string[:match.start()]}<a href='{link}'>{link}</a>{string[match.end():]}"
    return string


async def normalize(string: str) -> str:
    """Normalizes string for html specifically:
    - replaces \n with <br>
    - replaces urls with <a> tags

    Args:
        string (str): string to normalize

    Returns:
        str: normalized string
    """
    string = string.replace("\n", "<br>")
    string = await linkify(string)
    return string


@dataclass
class Request(ABC):
    """Base class for requests
    """

    @classmethod
    async def from_data(cls, data: dict[str, Any]) -> Self:
        """async method for creating a request object from data

        Args:
            data (dict[str, Any]): data used to create request

        Returns:
            Self: Request object
        """
        return cls(**data)


@dataclass
class Response(ABC):
    """Base class for responses
    """

    @classmethod
    @abstractmethod
    async def from_request(cls, request: Request) -> Self:
        """async method for creating a response from respective Request,
        must be overwritten in child with respective Request

        Args:
            request (Request): request used to create response

        Returns:
            Self: Response object
        """

    async def to_dict(self) -> dict[str, Any]:
        """async method for getting dict of response with response type

        Returns:
            dict[str, Any]: dict of response values with response object type
        """
        dic = self.__dict__
        dic["type"] = self.__class__.__name__
        return dic


@dataclass
class InputRequest(Request):
    """request for getting questions by user input

    Args:
        input (str): user input
    """
    input: str = ""


@dataclass
class InputResponse(Response):
    """response to InputRequest

    Args:
        questions (list[str]): list of questions fitting InputRequest
    """
    questions: list[str] = field(default_factory=list)

    @classmethod
    async def from_request(cls, request: InputRequest) -> Self:
        instance = cls()
        matches = await get_question_matches(request.input, await get_questions())
        instance.questions.extend(elem[0] for elem in matches[:MATCHES_LIMIT])
        return instance


@dataclass
class QuestionRequest(Request):
    """request for answer to question

    Args:
        question (str): question to get answer for
    """
    question: str = ""


@dataclass
class QuestionResponse(Response):
    """response to QuestionRequest

    Args:
        question (str): question to get answer for
        answer (str): answer to question
        pictures (list[str]): list of links to pictures related to answer
    """
    question: str = ""
    answer: str = ""
    pictures: list[str] = field(default_factory=list)

    @classmethod
    async def from_request(cls, request: QuestionRequest) -> Self:
        instance = cls()
        answer, links = await get_answer(request.question)
        instance.question = request.question
        instance.answer = await normalize(answer)
        for picture_link in links:
            instance.pictures.append(f"{DB_PICTURES_PATH}{picture_link}")
        return instance


async def get_request_object(data: dict[str, Any]) -> Request:
    """gets request object of correct type from data

    Args:
        data (dict[str, Any]): data to create request with

    Raises:
        ValueError: raised if request type doesn't exist

    Returns:
        Request: Request object
    """
    request_type_name = data["type"]
    for request_type in Request.__subclasses__():
        if request_type.__name__ == request_type_name:
            data.pop("type")
            return await request_type.from_data(data)
    raise ValueError(f"Unknown request type {request_type_name}")


async def get_response_object(request: Request) -> Response:
    """gets response object of correct type from request

    Args:
        request (Request): request to create response with

    Raises:
        ValueError: raised if response type doesn't exist

    Returns:
        Response: Response object
    """
    response_type_name = f"{request.__class__.__name__.removesuffix('Request')}Response"
    for response_type in Response.__subclasses__():
        if response_type.__name__ == response_type_name:
            return await response_type.from_request(request)
    raise ValueError(f"Unknown response type {response_type_name}")


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """websocket endpoint

    Args:
        websocket (WebSocket): websocket connection
    """
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_json()
            request = await get_request_object(data)
            response = await get_response_object(request)
            await websocket.send_json(await response.to_dict())
    except WebSocketDisconnect:
        ...
